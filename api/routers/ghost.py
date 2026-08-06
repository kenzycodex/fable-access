from fastapi import APIRouter, BackgroundTasks, HTTPException, Request

import audit
import notifications

from models.schemas import GhostCreateRequest, GhostActionRequest
from agents.ghost.account import (
    create_ghost_container,
    get_ghost_container,
    cancel_ghost,
    release_ghost,
    StepUpRequired,
    ExpiredContainer,
)
from tenancy import resolve_institution

router = APIRouter(prefix="/v1/ghost", tags=["ghost"])


@router.post("/create")
def create(payload: GhostCreateRequest, request: Request, background: BackgroundTasks):
    transaction = payload.transaction.model_dump()
    institution_id = resolve_institution(request, payload.institution_id)
    container = create_ghost_container(
        payload.user_id, transaction, payload.risk_score, payload.explanation,
        institution_id, payload.signals,
    )

    # Tell the customer out-of-band, on a channel the session cannot read.
    #
    # Containment used to notify nobody, so the only notice appeared on the
    # screen the transfer came from — the screen an attacker is holding in
    # exactly the case this feature exists to survive. A cooling window only
    # helps if the real customer learns about it in time to cancel.
    #
    # Backgrounded because the hold is already in place and the money is
    # already safe: a slow SMTP server must not delay the response, and a
    # failed send must not fail containment.
    audit.record(audit.CONTAINMENT_CREATED, payload.user_id,
                 ghost_id=container["ghost_id"], amount=transaction.get("amount"),
                 risk_score=payload.risk_score, institution_id=institution_id)

    background.add_task(
        notifications.notify_containment,
        payload.user_id, institution_id, container["ghost_id"],
        transaction.get("amount", 0), transaction.get("recipient_name"),
        container["cooling_window_minutes"], payload.explanation,
    )
    return container


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


@router.post("/{ghost_id}/confirm")
def confirm(ghost_id: str, payload: GhostActionRequest):
    try:
        return release_ghost(ghost_id, payload.user_id, payload.stepup_token)
    except ExpiredContainer as e:
        # 410, not 409: the hold existed and is now gone by design. Cancelling
        # is still available, so the client can offer the safe action.
        raise HTTPException(
            status_code=410,
            detail={"error": "container_expired", "message": str(e), "can_cancel": True},
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
