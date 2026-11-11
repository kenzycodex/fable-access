"""Fable in front of the Xtradot Bank sandbox.

The flow a customer's app follows:

    POST /v1/forge/enquiry               who owns the account? (the app shows the name)
    POST /v1/forge/transfer              Fable scores it, then:
        PASS  -> sent to the bank at once
        FLAG  -> waits for the customer to verify  -> POST /v1/forge/transfers/{id}/confirm
        BLOCK -> held by Ghost for a cooling window -> POST /v1/forge/transfers/{id}/release
                                                       or POST /v1/forge/transfers/{id}/cancel
    GET  /v1/forge/transfers/{id}        where is it now? (also asks the bank if it is unsettled)

Fable decides and the bank moves the money. This needs an institution in live
mode, so Fable's own simulated ledger stays out of it and the bank's balance is
the only one that counts. Calls come from the bank-side server with its API key.
"""
import hashlib
import hmac
import json
import logging
import os
import time

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Request
from pydantic import BaseModel, Field

from agents.ghost.account import ExpiredContainer, StepUpRequired, cancel_ghost, release_ghost
from core.tenancy import scoring_guard
from models.schemas import Context, Device, ShieldAnalyzeRequest, Transaction
from routers.ghost import hold_from_decision
from routers.shield import analyze
from routers.transactions import ApproveRequest, approve
from services import forge_bank, forge_transfers
from services.forge_bank import BankError

router = APIRouter(prefix="/v1/forge", tags=["forge"])
logger = logging.getLogger("fable.forge")


class EnquiryRequest(BaseModel):
    user_id: str
    account_number: str = Field(min_length=10, max_length=10, pattern=r"^\d{10}$")
    bank_code: str | None = Field(None, max_length=10)
    intra: bool = False


class TransferRequest(BaseModel):
    user_id: str
    source_account: str = Field(pattern=r"^\d{10}$")
    destination_account: str = Field(pattern=r"^\d{10}$")
    destination_bank_code: str | None = Field(None, max_length=10)
    intra: bool = False
    name_enquiry_ref: str
    # The name the bank returned and the customer saw, exactly as shown.
    recipient_name: str
    amount: float = Field(gt=0, le=1_000_000_000)
    narration: str = Field("", max_length=100)
    # The caller's own id for this attempt. A repeat is recognised, not re-scored or re-sent.
    client_reference: str = Field(min_length=6, max_length=80)
    device: Device | None = None
    context: Context | None = None


class ConfirmRequest(BaseModel):
    user_id: str
    stepup_token: str | None = None


class ReleaseRequest(BaseModel):
    user_id: str
    ghost_id: str
    stepup_token: str | None = None


def _bank_http(exc: BankError) -> HTTPException:
    status = exc.status if 400 <= exc.status < 500 else 504 if exc.status == 504 else 502
    return HTTPException(status_code=status, detail={"error": exc.code.lower(), "message": exc.message,
                                                     "field": exc.field, "bank_request_id": exc.request_id})


def _view(row: dict) -> dict:
    """What the caller sees of a transfer: its state and the bank's own charges."""
    return {k: row[k] for k in ("id", "reference", "state", "amount", "recipient_name", "destination_account",
                                "fee", "vat", "stamp_duty", "total_debit", "last_error", "updated_at")}


@router.post("/enquiry", dependencies=[Depends(scoring_guard)])
def enquiry(payload: EnquiryRequest):
    try:
        data = forge_bank.name_enquiry(payload.account_number, payload.bank_code, intra=payload.intra)
    except BankError as exc:
        raise _bank_http(exc) from exc
    return {"account_name": data.get("account_name"), "name_enquiry_ref": data.get("name_enquiry_ref"),
            "bank_name": data.get("bank_name"), "expires_in_seconds": 600}


@router.post("/transfer", dependencies=[Depends(scoring_guard)])
def transfer(payload: TransferRequest, request: Request, background: BackgroundTasks):
    if request.state.mode != "live":
        raise HTTPException(status_code=409, detail={
            "error": "institution_not_live",
            "message": "Forge transfers need an institution in live mode, so the bank's balance is the only one used."})
    if not payload.intra and not payload.destination_bank_code:
        raise HTTPException(status_code=422, detail={"error": "invalid_request", "field": "destination_bank_code",
                                                     "message": "destination_bank_code is required for an interbank transfer."})

    # What the customer could spend, from the bank itself, so Shield can see a drained account.
    balance_before = None
    try:
        bal = forge_bank.balance(payload.source_account)
        balance_before = float(bal.get("available_balance", bal.get("balance")))
    except Exception:  # noqa: BLE001 - scoring goes ahead without it
        logger.info("Balance unavailable for scoring; scoring without it.")

    decision = analyze(
        ShieldAnalyzeRequest(
            user_id=payload.user_id,
            transaction=Transaction(
                amount=payload.amount, recipient_account=payload.destination_account,
                recipient_bank_code=payload.destination_bank_code, recipient_name=payload.recipient_name,
                narration=payload.narration, channel="mobile_app", balance_before=balance_before),
            device=payload.device, context=payload.context,
            client_reference=payload.client_reference),
        request)

    existing = forge_transfers.get(decision.transaction_id)
    if existing:
        # A retry of an attempt already handled: answer with where it stands.
        return {"decision": decision, "transfer": _view(forge_transfers.refresh(existing["id"]) or existing)}

    row = forge_transfers.record(
        transfer_id=decision.transaction_id, institution_id=request.state.institution_id,
        user_id=payload.user_id, source_account=payload.source_account,
        destination_account=payload.destination_account, destination_bank_code=payload.destination_bank_code,
        intra=payload.intra, recipient_name=payload.recipient_name, amount=payload.amount,
        narration=payload.narration, name_enquiry_ref=payload.name_enquiry_ref, action=decision.action)

    next_step, hold = None, None
    if decision.action == "PASS":
        row = forge_transfers.execute(row["id"])
    elif decision.action == "FLAG":
        next_step = "step_up"
    else:
        hold = hold_from_decision(request, background, payload.user_id, row["id"])
        next_step = "ghost_hold"
    return {"decision": decision, "transfer": _view(row), "next": next_step, "hold": hold}


def _owned(txid: str, request: Request) -> dict:
    row = forge_transfers.get(txid)
    if not row or row["institution_id"] != request.state.institution_id:
        raise HTTPException(status_code=404, detail="Unknown transfer")
    return row


@router.get("/transfers/{txid}", dependencies=[Depends(scoring_guard)])
def status(txid: str, request: Request):
    row = _owned(txid, request)
    return _view(forge_transfers.refresh(txid) or row)


@router.post("/transfers/{txid}/confirm", dependencies=[Depends(scoring_guard)])
def confirm(txid: str, payload: ConfirmRequest, request: Request):
    """The customer verified a flagged transfer. The step-up check is the
    existing approve logic; the money moves only once it passes."""
    row = _owned(txid, request)
    if row["action"] != "FLAG":
        raise HTTPException(status_code=409, detail="Only a flagged transfer is confirmed this way.")
    approve(txid, ApproveRequest(user_id=payload.user_id, stepup_token=payload.stepup_token), request)
    return _view(forge_transfers.execute(txid))


@router.post("/transfers/{txid}/release", dependencies=[Depends(scoring_guard)])
def release(txid: str, payload: ReleaseRequest, request: Request):
    """The customer released a held transfer with the proof Ghost demands."""
    row = _owned(txid, request)
    if row["action"] != "BLOCK":
        raise HTTPException(status_code=409, detail="Only a held transfer is released this way.")
    try:
        release_ghost(payload.ghost_id, payload.user_id, payload.stepup_token)
    except ExpiredContainer as exc:
        raise HTTPException(status_code=410, detail={"error": "container_expired", "message": str(exc)}) from exc
    except StepUpRequired as exc:
        raise HTTPException(status_code=401, detail={"error": "step_up_required", "level": exc.level,
                                                     "message": str(exc)}) from exc
    except (ValueError, PermissionError) as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    return _view(forge_transfers.execute(txid))


@router.post("/transfers/{txid}/cancel", dependencies=[Depends(scoring_guard)])
def cancel(txid: str, payload: ConfirmRequest, request: Request):
    """Cancelling is free and always safe: nothing was ever sent."""
    row = _owned(txid, request)
    if row["state"] not in ("awaiting_stepup", "held"):
        raise HTTPException(status_code=409, detail=f"A transfer that is {row['state']} cannot be cancelled.")
    if row["action"] == "BLOCK":
        from core.db import cursor
        with cursor() as cur:
            cur.execute("SELECT ghost_id FROM ghost_containers WHERE transaction_id = ? ORDER BY rowid DESC LIMIT 1", (txid,))
            ghost = cur.fetchone()
        if ghost:
            cancel_ghost(ghost["ghost_id"], payload.user_id)
    forge_transfers._set(txid, state="cancelled")  # noqa: SLF001 - same package, one writer
    return _view(forge_transfers.get(txid))


# --- Bank webhooks ------------------------------------------------------------

HOOK_PATH = "/v1/forge/hooks/bank"
TOLERANCE_SECONDS = 300


def verify_signature(raw: bytes, timestamp: str, signature: str, secret: str) -> bool:
    """x-forge-signature is sha256=<hex HMAC-SHA256 of "{timestamp}.{raw_body}">,
    and a timestamp more than 5 minutes old is refused."""
    try:
        if abs(time.time() - int(timestamp)) > TOLERANCE_SECONDS:
            return False
    except (TypeError, ValueError):
        return False
    mac = hmac.new(secret.encode(), timestamp.encode() + b"." + raw, hashlib.sha256).hexdigest()
    return hmac.compare_digest("sha256=" + mac, signature or "")


@router.post("/hooks/bank")
async def bank_webhook(request: Request):
    """Outcomes from the bank. Open to the cluster but authenticated by the
    signature alone; anything unsigned or stale is refused, and an event already
    handled changes nothing."""
    secret = os.getenv("FORGE_WEBHOOK_SECRET", "").strip()
    if not secret:
        raise HTTPException(status_code=503, detail="Webhook secret is not configured.")
    raw = await request.body()
    if not verify_signature(raw, request.headers.get("x-forge-timestamp", ""),
                            request.headers.get("x-forge-signature", ""), secret):
        raise HTTPException(status_code=401, detail="Bad signature.")
    try:
        body = json.loads(raw)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail="Body is not JSON.") from exc

    event = request.headers.get("x-forge-event") or body.get("event") or ""
    event_id = str(body.get("event_id") or body.get("id") or "")
    if not event_id:
        raise HTTPException(status_code=400, detail="No event_id.")
    data = body.get("data") if isinstance(body.get("data"), dict) else body

    from core.db import cursor
    with cursor() as cur:
        cur.execute("INSERT OR IGNORE INTO forge_events (event_id, event) VALUES (?, ?)", (event_id, event))
        first_time = cur.rowcount == 1
    if not first_time:
        return {"status": "duplicate"}
    updated = forge_transfers.apply_event(event, data)
    return {"status": "ok", "matched": updated is not None}
