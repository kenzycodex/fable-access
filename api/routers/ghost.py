"""Ghost holds, as the customer's app sees them.

A hold is opened from a decision Fable stored (POST /v1/ghost/create with the
decision's transaction_id, or POST /v1/transactions/{id}/hold). Whatever risk
score, signals or explanation a caller sends is ignored: those values set the
hold's length and the strength of proof a release needs, so they come only
from the stored decision.
"""
import logging

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Request

from agents.ghost.account import (
    ExpiredContainer,
    HoldError,
    StepUpRequired,
    cancel_ghost,
    find_decision,
    get_ghost_container,
    open_hold,
    release_ghost,
    request_release,
)
from core.tenancy import customer_guard, disabled_agents
from models.schemas import GhostActionRequest, GhostCreateRequest
from services import notifications

router = APIRouter(prefix="/v1/ghost", tags=["ghost"], dependencies=[Depends(customer_guard)])
logger = logging.getLogger("fable.ghost")


def hold_from_decision(request: Request, background: BackgroundTasks, user_id: str,
                       transaction_id: str) -> dict:
    """Open (or return) the hold for a stored decision and tell the customer."""
    institution_id = request.state.institution_id
    # An institution that has switched Ghost off gets no containment. Refusing
    # here is the honest behaviour: silently containing anyway would make the
    # toggle a lie in the other direction.
    if "ghost" in disabled_agents(institution_id):
        raise HTTPException(
            status_code=409,
            detail={"error": "agent_disabled",
                    "message": "Ghost containment is switched off for this institution."},
        )
    try:
        container, created = open_hold(transaction_id, user_id, institution_id)
    except HoldError as exc:
        raise HTTPException(status_code=exc.status, detail={"error": exc.code, "message": str(exc)})

    if created:
        # Tell the customer out-of-band, on a channel the session cannot read:
        # a cooling window only helps if the real customer learns about it in
        # time to cancel. Backgrounded because the hold is already in place.
        background.add_task(
            notifications.notify_containment,
            user_id, institution_id, container["ghost_id"],
            container.get("amount", 0), None,
            container["cooling_window_minutes"], container.get("explanation") or "",
        )
    return container


@router.post("/create")
def create(payload: GhostCreateRequest, request: Request, background: BackgroundTasks):
    """Hold a blocked transfer the customer still wants to send.

    Send the decision's `transaction_id`. Older clients that send only the
    transfer are matched to the customer's own recent block for the same amount
    and recipient; if there is none, the request is refused.
    """
    if payload.risk_score is not None or payload.signals or payload.explanation:
        logger.warning("ghost/create ignored caller-supplied risk, signals or explanation; "
                       "the stored decision is used.")
    transaction_id = payload.transaction_id
    if not transaction_id and payload.transaction is not None:
        from services.sandbox_recipients import apply_token

        transaction = payload.transaction.model_dump()
        apply_token(transaction, request.state.customer["id"])
        transaction_id = find_decision(payload.user_id, request.state.institution_id,
                                       transaction["amount"], transaction.get("recipient_account"))
    if not transaction_id:
        raise HTTPException(
            status_code=422,
            detail={"error": "transaction_id_required",
                    "message": "Say which blocked transfer to hold: send its transaction_id."},
        )
    return hold_from_decision(request, background, payload.user_id, transaction_id)


@router.get("/{ghost_id}")
def get(ghost_id: str):
    container = get_ghost_container(ghost_id)
    if not container:
        raise HTTPException(status_code=404, detail="Ghost container not found")
    return container


@router.post("/{ghost_id}/cancel")
def cancel(ghost_id: str, payload: GhostActionRequest):
    try:
        return cancel_ghost(ghost_id, payload.user_id)
    except ValueError as e:
        raise HTTPException(status_code=409, detail=str(e))
    except PermissionError as e:
        raise HTTPException(status_code=403, detail=str(e))


@router.post("/{ghost_id}/request-release")
def ask_bank_to_release(ghost_id: str, payload: GhostActionRequest):
    """The customer cannot produce the proof a release needs (for example they
    have no passkey) and asks their bank to verify them another way. The hold
    stays, its window is extended, and it goes to the bank's review queue."""
    try:
        return request_release(ghost_id, payload.user_id)
    except HoldError as exc:
        raise HTTPException(status_code=exc.status, detail={"error": exc.code, "message": str(exc)})


@router.post("/{ghost_id}/confirm")
def confirm(ghost_id: str, payload: GhostActionRequest):
    try:
        return release_ghost(ghost_id, payload.user_id, payload.stepup_token)
    except ExpiredContainer as e:
        # 410, not 409: the hold existed and is now gone by design.
        raise HTTPException(
            status_code=410,
            detail={"error": "container_expired", "message": str(e), "can_cancel": False},
        )
    except StepUpRequired as e:
        # 401 with the demanded level, so the client knows which factor to run
        # rather than just being told no.
        raise HTTPException(
            status_code=401,
            detail={"error": "step_up_required", "level": e.level, "message": str(e)},
        )
    except ValueError as e:
        raise HTTPException(status_code=409, detail=str(e))
    except PermissionError as e:
        raise HTTPException(status_code=403, detail=str(e))
