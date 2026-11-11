"""Transaction lifecycle: recording the outcome after Shield's decision.

Shield's decision (action_taken) is fixed the moment it's made. What happens
next — the customer verifies a flagged transfer and sends it, cancels it, or
routes a block into containment — is a separate lifecycle, and it belongs on
the transaction so every surface (the customer's history, the institution
console) agrees on where the money ended up.
"""
from typing import Optional

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Request
from pydantic import BaseModel

from agents.shield import assurance
from agents.shield import stepup as stepup_service
from core.db import cursor, loads, row_to_dict
from core.tenancy import customer_guard
from services.accounts import InsufficientFunds, assert_can_spend, debit

router = APIRouter(prefix="/v1/transactions", tags=["transactions"], dependencies=[Depends(customer_guard)])

# Outcomes a client may record. Kept explicit so a stray value can't overwrite
# a transaction's status with something the rest of the app doesn't understand.
VALID_STATUSES = {"completed", "flagged", "blocked", "cancelled", "held", "released", "expired"}

# Statuses only the server sets: an approval, a hold and its outcome. A client
# reporting one of them is accepted only when it is already true (a retry).
SERVER_STATUSES = {"held", "released", "expired"}
SETTLED = {"completed", "released", "cancelled", "expired"}


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

    current = row.get("status")
    if payload.status == current:
        return {"id": txid, "status": current}
    action = row.get("action_taken") or "PASS"
    # This endpoint used to accept any of these statuses and mark "completed"
    # or "released" as confirmed legitimate, which is what the baselines learn
    # from. A client could therefore mark its own blocked transfer as settled
    # and teach Fable that the recipient and amount were normal. Only the
    # server's own approval and release paths may do that now.
    if payload.status in SERVER_STATUSES:
        raise HTTPException(status_code=409, detail="Fable sets this status itself when a hold changes.")
    if payload.status == "completed" and action != "PASS":
        raise HTTPException(status_code=409, detail="A flagged transfer is completed by verifying it, and a "
                                                    "blocked one through a hold.")
    if payload.status in ("flagged", "blocked") and payload.status != {"FLAG": "flagged", "BLOCK": "blocked"}.get(action):
        raise HTTPException(status_code=409, detail="That status does not match Fable's decision.")
    if current in SETTLED:
        raise HTTPException(status_code=409, detail=f"This transfer is already {current}.")

    # A cleared transfer that settles is the customer's own normal behaviour
    # and teaches the baseline; a cancelled one teaches nothing.
    confirmed = 1 if payload.status == "completed" else 0
    with cursor() as cur:
        cur.execute(
            "UPDATE transactions SET status = ?, confirmed_legitimate = ? WHERE id = ?",
            (payload.status, confirmed, txid),
        )
    return {"id": txid, "status": payload.status}


class HoldRequest(BaseModel):
    user_id: str


@router.post("/{txid}/hold")
def hold(txid: str, payload: HoldRequest, request: Request, background: BackgroundTasks):
    """Hold a blocked transfer the customer still wants to send.

    The same as /v1/ghost/create with a transaction_id: the hold takes its risk,
    signals and explanation from this stored decision.
    """
    from routers.ghost import hold_from_decision

    return hold_from_decision(request, background, payload.user_id, txid)


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
    from core import security
    always_ask = bool(security.status(payload.user_id).get("two_factor_enabled"))
    required = assurance.required_level(
        row.get("risk_score") or 0.0, signals, action, always_ask=always_ask
    )

    if required != "none":
        proved = stepup_service.verify_token(payload.stepup_token, payload.user_id, "transfer", txid)
        if not assurance.satisfies(proved, required):
            stepup_service.record_failure(payload.user_id, "transfer_approve", f"missing_{required}")
            raise HTTPException(
                status_code=401,
                detail={"error": "step_up_required", "level": required, "message": "Verify it's you to send this transfer."},
            )
        # Spent atomically: of two approvals racing with one token, one wins.
        if not stepup_service.consume_token(payload.stepup_token):
            raise HTTPException(
                status_code=401,
                detail={"error": "step_up_required", "level": required, "message": "Verify again to send this transfer."},
            )

    institution_id = request.state.institution_id

    # Only the sandbox has a Fable ledger. A live bank moves the money itself,
    # once this approval tells it the customer verified.
    if request.state.mode != "live":
        # Funds are re-checked at approval time: the balance may have moved
        # between scoring and the customer confirming.
        try:
            assert_can_spend(payload.user_id, row["amount"], institution_id)
        except InsufficientFunds as exc:
            raise HTTPException(
                status_code=422,
                detail={"error": "insufficient_funds", "message": str(exc), "available": exc.available,
                        "requested": exc.requested, "shortfall": exc.shortfall},
            )

        debit(payload.user_id, row["amount"], institution_id, transaction_id=txid, reference=f"txn-approve:{txid}")
        from services import forge_bridge

        forge_bridge.mirror_later(txid)

    # Verified and sent: the customer proved it was them, so this transfer now
    # teaches the baseline (recipient, device, amount, hour) for next time.
    with cursor() as cur:
        cur.execute(
            "UPDATE transactions SET status = 'completed', confirmed_legitimate = 1 WHERE id = ?",
            (txid,),
        )

    from services import audit, webhooks
    audit.record(audit.TRANSFER_APPROVED, payload.user_id, transaction_id=txid,
                 amount=row["amount"], required_factor=required,
                 institution_id=institution_id)
    # A live bank sends the money itself; this is its signal that the customer
    # verified and the transfer may go.
    webhooks.emit(institution_id, "transaction.approved", {
        **webhooks.transaction_summary({**row, "status": "completed"}),
        "verified_level": required,
    })

    return {"id": txid, "status": "completed"}
