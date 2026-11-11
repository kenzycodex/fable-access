"""A local stand-in for the Xtradot Bank sandbox, for running the demo off the cluster.

The real sandbox only answers from inside the Forge cluster. This follows the
platform guide's contract closely enough for the demo (section 5): the response
envelope, name enquiry before transfer, intrabank settling in the call and
interbank pending then settling after about 5 seconds, fees and VAT read from
the response, idempotency keys, and the guide's trigger amounts (.01 refused for
funds, .02 times out and is reversed after 30 seconds, .03 pending for 2
minutes). It is not the bank: anything shown from it must be called simulated.

    python scripts/mock_bank.py          # listens on 0.0.0.0:9000, base path /v1
"""
import json
import os
import sys
import time
import uuid

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import uvicorn  # noqa: E402
from fastapi import FastAPI, Request  # noqa: E402
from fastapi.responses import JSONResponse  # noqa: E402

from services.forge_bridge import BANKS, BENEFICIARIES, TEAM_ACCOUNTS, XTRADOT_NIP  # noqa: E402

app = FastAPI(title="Xtradot Bank (simulated)")
DORMANT, FROZEN, PND = "0987654399", "0123987098", "0123987099"
_transfers: dict[str, dict] = {}
_replies: dict[str, tuple[int, dict]] = {}
_enquiries: dict[str, dict] = {}


def ok(data, status=200):
    return JSONResponse({"status": "success", "message": "OK", "data": data, "meta": None,
                         "request_id": f"req_{uuid.uuid4().hex[:8]}"}, status_code=status)


def err(status, code, message, field=None):
    body = {"code": code, "message": message}
    if field:
        body["field"] = field
    return JSONResponse({"status": "error", "error": body, "request_id": f"req_{uuid.uuid4().hex[:8]}"},
                        status_code=status)


def charges(amount: float, intra: bool) -> dict:
    if intra:
        return {"fee": 0.0, "vat": 0.0, "stamp_duty": 0.0, "total_debit": round(amount, 2)}
    fee = 10.0 if amount <= 5_000 else 25.0 if amount <= 50_000 else 50.0
    vat = round(fee * 0.075, 2)
    return {"fee": fee, "vat": vat, "stamp_duty": 0.0, "total_debit": round(amount + fee + vat, 2)}


def cents(amount: float) -> int:
    return round(amount * 100) % 100


def state(ref: str) -> dict | None:
    t = _transfers.get(ref)
    if not t:
        return None
    age = time.time() - t["at"]
    if t["mode"] == "timeout":
        status = "reversed" if age > 30 else "pending"
    elif t["mode"] == "slow":
        status = "successful" if age > 120 else "pending"
    elif t["mode"] == "intra":
        status = "successful"
    else:
        status = "successful" if age > 5 else "pending"
    return {"reference": ref, "status": status, "amount": t["amount"], **charges(t["amount"], t["mode"] == "intra")}


@app.middleware("http")
async def key_required(request: Request, call_next):
    if not request.headers.get("x-api-key"):
        return err(401, "UNAUTHORIZED", "Missing x-api-key.")
    return await call_next(request)


@app.get("/v1/accounts/{account}/balance")
def balance(account: str):
    if account not in TEAM_ACCOUNTS:
        return err(404, "ACCOUNT_NOT_FOUND", "No such account.")
    return ok({"account_number": account, "balance": TEAM_ACCOUNTS[account][1], "currency": "NGN"})


def _enquire(account: str, intra: bool):
    if account in (DORMANT,):
        return err(422, "ACCOUNT_DORMANT", "The beneficiary account is dormant.")
    if account in (FROZEN,):
        return err(422, "BENEFICIARY_FROZEN", "The beneficiary account is frozen.")
    holder = BENEFICIARIES.get(account)
    if holder is None and account in TEAM_ACCOUNTS:
        holder = (TEAM_ACCOUNTS[account][0], "Xtradot Bank")
    if not holder:
        return err(404, "ACCOUNT_NOT_FOUND", "No such account.", "account_number")
    if intra != (BANKS.get(holder[1]) == XTRADOT_NIP):
        return err(400, "INVALID_REQUEST", "Use /intra for Xtradot Bank accounts and /interbank for other banks.")
    ref = f"ne_{uuid.uuid4().hex[:12]}"
    _enquiries[ref] = {"account": account, "at": time.time(), "used": False}
    return ok({"account_number": account, "account_name": holder[0], "bank_name": holder[1], "name_enquiry_ref": ref})


@app.post("/v1/transfers/intra/name-enquiry")
async def intra_enquiry(request: Request):
    return _enquire(str((await request.json()).get("account_number", "")), True)


@app.post("/v1/transfers/interbank/name-enquiry")
async def interbank_enquiry(request: Request):
    return _enquire(str((await request.json()).get("account_number", "")), False)


async def _transfer(request: Request, intra: bool):
    key = request.headers.get("idempotency-key")
    if not key:
        return err(400, "INVALID_REQUEST", "Idempotency-Key is required.", "Idempotency-Key")
    if key in _replies:
        status, body = _replies[key]
        reply = JSONResponse(body, status_code=status)
        reply.headers["Idempotent-Replayed"] = "true"
        return reply
    body = await request.json()
    ref, amount, enq = body.get("reference", ""), float(body.get("amount", 0)), _enquiries.get(body.get("name_enquiry_ref", ""))
    if not enq or enq["account"] != body.get("destination_account"):
        reply = err(409, "NAME_ENQUIRY_MISMATCH", "Name enquiry missing or for another account.")
    elif enq["used"]:
        reply = err(409, "DUPLICATE_REQUEST", "This name enquiry reference was already used.")
    elif time.time() - enq["at"] > 600:
        reply = err(409, "NAME_ENQUIRY_EXPIRED", "The name enquiry is older than 10 minutes.")
    elif ref in _transfers:
        reply = err(409, "DUPLICATE_REQUEST", "This reference was already used.")
    elif cents(amount) == 1:
        reply = err(402, "INSUFFICIENT_FUNDS", "Balance below amount plus charges.")
    else:
        enq["used"] = True
        mode = "intra" if intra else "timeout" if cents(amount) == 2 else "slow" if cents(amount) == 3 else "normal"
        _transfers[ref] = {"mode": mode, "at": time.time(), "amount": amount}
        if mode == "timeout":
            reply = err(504, "TIMEOUT", "Outcome unknown: requery, never resend.")
        else:
            reply = ok(state(ref), 201 if intra else 202)
    _replies[key] = (reply.status_code, json.loads(reply.body))
    return reply


@app.post("/v1/transfers/intra")
async def intra(request: Request):
    return await _transfer(request, True)


@app.post("/v1/transfers/interbank")
async def interbank(request: Request):
    return await _transfer(request, False)


@app.post("/v1/transfers/interbank/requery")
async def requery(request: Request):
    found = state(str((await request.json()).get("reference", "")))
    return ok(found) if found else err(404, "NOT_FOUND", "No such transfer.")


@app.get("/v1/transfers/{reference}")
def transfer_status(reference: str):
    found = state(reference)
    return ok(found) if found else err(404, "NOT_FOUND", "No such transfer.")


if __name__ == "__main__":
    uvicorn.run(app, host="0.0.0.0", port=int(os.getenv("MOCK_BANK_PORT", "9000")), log_level="warning")
