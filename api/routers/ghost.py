from fastapi import APIRouter, HTTPException

from models.schemas import GhostCreateRequest, GhostActionRequest
from agents.ghost.account import (
    create_ghost_container,
    get_ghost_container,
    cancel_ghost,
    release_ghost,
)

router = APIRouter(prefix="/v1/ghost", tags=["ghost"])


@router.post("/create")
def create(payload: GhostCreateRequest):
    transaction = payload.transaction.model_dump()
    return create_ghost_container(payload.user_id, transaction, payload.risk_score, payload.explanation)


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
        return release_ghost(ghost_id, payload.user_id)
    except ValueError as e:
        raise HTTPException(status_code=409, detail=str(e))
    except PermissionError as e:
        raise HTTPException(status_code=403, detail=str(e))
