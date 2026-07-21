"""Transaction lifecycle: recording the outcome after Shield's decision.

Shield's decision (action_taken) is fixed the moment it's made. What happens
next — the customer verifies a flagged transfer and sends it, cancels it, or
routes a block into containment — is a separate lifecycle, and it belongs on
the transaction so every surface (the customer's history, the institution
console) agrees on where the money ended up.
"""
from typing import Optional

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel

from db import cursor, loads, row_to_dict
from tenancy import resolve_institution
from accounts import InsufficientFunds, assert_can_spend, debit
from agents.shield import assurance, stepup as stepup_service

router = APIRouter(prefix="/v1/transactions", tags=["transactions"])

# Outcomes a client may record. Kept explicit so a stray value can't overwrite
# a transaction's status with something the rest of the app doesn't understand.
VALID_STATUSES = {"completed", "flagged", "blocked", "cancelled", "held", "released"}


def _get(txid: str) -> dict | None:
    with cursor() as cur:
        cur.execute("SELECT * FROM transactions WHERE id = ?", (txid,))
        return row_to_dict(cur.fetchone())


class StatusUpdate(BaseModel):
    status: str
    user_id: Optional[str] = None


@router.post("/{txid}/status")
def set_status(txid: str, payload: StatusUpdate):
    """Record a transfer's lifecycle outcome (cancelled, released, …).

    A pure bookkeeping write — it moves no money. The actions that *do* move
    money (a flag approval, a Ghost release) go through their own guarded
    endpoints and set the status themselves.
    """
    if payload.status not in VALID_STATUSES:
        raise HTTPException(status_code=400, detail=f"Unknown status '{payload.status}'.")

    row = _get(txid)
    if not row:
        raise HTTPException(status_code=404, detail="Unknown transaction")
    if payload.user_id and row["user_id"] != payload.user_id:
        raise HTTPException(status_code=403, detail="Unauthorized")

    with cursor() as cur:
        cur.execute("UPDATE transactions SET status = ? WHERE id = ?", (payload.status, txid))
    return {"id": txid, "status": payload.status}


class ApproveRequest(BaseModel):
    user_id: str
    stepup_token: Optional[str] = None


@router.post("/{txid}/approve")
def approve(txid: str, payload: ApproveRequest, request: Request):
    """Proceed with a flagged transfer after the customer verifies it's them.

    A FLAG is medium risk — "confirm you meant it", not "this is fraud" — so a
    verified customer's transfer completes directly, with no cooling window.
    That is the proportional, lower-friction path a block never gets: a block
    is contained precisely because a socially-engineered customer would verify
    it too.

    The factor demanded is the flag's own assurance tier, and the money only
    moves once it's satisfied. Blocks are not approved here; they go through
    Ghost.
    """
    row = _get(txid)
    if not row:
        raise HTTPException(status_code=404, detail="Unknown transaction")
    if row["user_id"] != payload.user_id:
        raise HTTPException(status_code=403, detail="Unauthorized")

    action = row.get("action_taken") or "PASS"
    if action == "BLOCK":
        # A block is contained, not approved. Routing it here would skip the
        # cooling window that is the entire point of blocking it.
        raise HTTPException(status_code=409, detail="Blocked transfers are released through containment, not approved.")
    if row.get("status") in ("completed", "released"):
        # Idempotent: a retried approval of an already-sent transfer is a no-op,
        # not a second debit.
        return {"id": txid, "status": row["status"], "already": True}

    signals = loads(row.get("shield_signals"), []) if row.get("shield_signals") else []
    required = assurance.required_level(row.get("risk_score") or 0.0, signals, action)

    if required != "none":
        proved = stepup_service.verify_token(payload.stepup_token, payload.user_id, "transfer", txid)
        if not assurance.satisfies(proved, required):
            stepup_service.record_failure(payload.user_id, "transfer_approve", f"missing_{required}")
            raise HTTPException(
                status_code=401,
                detail={"error": "step_up_required", "level": required, "message": "Verify it's you to send this transfer."},
            )
        if payload.stepup_token:
            stepup_service.consume_token(payload.stepup_token)

    institution_id = resolve_institution(request, row.get("institution_id"))

    # Funds are re-checked at approval time: the balance may have moved between
    # scoring and the customer confirming.
    try:
        assert_can_spend(payload.user_id, row["amount"], institution_id)
    except InsufficientFunds as exc:
        raise HTTPException(
            status_code=422,
            detail={"error": "insufficient_funds", "message": str(exc), "available": exc.available,
                    "requested": exc.requested, "shortfall": exc.shortfall},
        )

    debit(payload.user_id, row["amount"], institution_id, transaction_id=txid, reference=f"txn-approve:{txid}")

    with cursor() as cur:
        cur.execute("UPDATE transactions SET status = 'completed' WHERE id = ?", (txid,))

    return {"id": txid, "status": "completed"}
