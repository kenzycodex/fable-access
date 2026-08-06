"""Institution registry.

The demo bank calls this to validate the institution slug in its URL
(/demo/{institution}) and to render the tenant's name and customer roster.
"""
from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel

import sessions
from db import cursor
from tenancy import get_institution, institution_from_api_key, list_institutions
from agents.copilot.demo_customers import customers_for_institution

router = APIRouter(prefix="/v1/institutions", tags=["institutions"])


@router.get("")
def index():
    return {"institutions": list_institutions()}


@router.get("/{institution_id}")
def detail(institution_id: str):
    inst = get_institution(institution_id)
    if not inst:
        raise HTTPException(status_code=404, detail="Institution not found")
    # Deliberately no credentials here: the demo bank calls this endpoint, and
    # it must never be able to read an institution's secret key.
    return {**inst, "customers": customers_for_institution(institution_id)}


class ResolveKeyRequest(BaseModel):
    api_key: str


@router.post("/resolve-key")
def resolve_key(payload: ResolveKeyRequest):
    """Which institution does this API key belong to?

    The demo bank calls this when a key is pasted into "Connect institution".
    Without it the field accepted any string and reported success, while the
    backend quietly attributed writes elsewhere — the UI said one tenant and
    the data went to another.
    """
    institution_id = institution_from_api_key(payload.api_key.strip())
    if not institution_id:
        raise HTTPException(status_code=401, detail="That API key isn't recognised.")

    inst = get_institution(institution_id)
    return {
        "institution_id": institution_id,
        "name": (inst or {}).get("name", institution_id),
        "demo_url": f"/demo/{institution_id}",
    }


def _mask(key: str) -> str:
    """fbl_live_9c2a…4a91 — enough to recognise, not enough to use."""
    if len(key) <= 16:
        return key
    return f"{key[:13]}{'•' * 8}{key[-4:]}"


@router.get("/{institution_id}/credentials")
def credentials(institution_id: str, request: Request):
    """The institution's own API key, for its settings screen.

    This used to return the live plaintext key with no authentication at all.
    Chained with `GET /v1/institutions`, which lists every tenant id, that was
    complete credential harvesting for the whole platform in two requests. The
    old docstring acknowledged it needed a session and noted there wasn't one;
    now there is, so it is gated.

    A session only unlocks its *own* institution's key. The key is returned in
    full because the console offers copy-to-clipboard and there is nowhere else
    to retrieve it from; most providers show a secret once at creation and only
    the mask thereafter, which is the better pattern and is noted as follow-up.
    """
    try:
        payload = sessions.verify(sessions.extract_token(request))
    except sessions.SessionError as exc:
        raise HTTPException(status_code=401, detail=str(exc))

    if payload["inst"] != institution_id:
        # Deliberately 404 rather than 403: confirming that a tenant exists is
        # itself the reconnaissance step that made the original hole useful.
        raise HTTPException(status_code=404, detail="Institution not found")

    inst = get_institution(institution_id)
    if not inst:
        raise HTTPException(status_code=404, detail="Institution not found")

    with cursor() as cur:
        cur.execute(
            """SELECT key, created_at FROM api_keys
               WHERE institution_id = ? AND is_active = 1
               ORDER BY created_at DESC LIMIT 1""",
            (institution_id,),
        )
        row = cur.fetchone()

    if not row:
        return {"institution_id": institution_id, "api_key": None, "masked_key": None, "created_at": None}

    return {
        "institution_id": institution_id,
        "api_key": row["key"],
        "masked_key": _mask(row["key"]),
        "created_at": row["created_at"],
    }
