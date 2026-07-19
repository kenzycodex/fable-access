"""Institution registry.

The demo bank calls this to validate the institution slug in its URL
(/demo/{institution}) and to render the tenant's name and customer roster.
"""
from fastapi import APIRouter, HTTPException

from db import cursor
from tenancy import get_institution, list_institutions
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


def _mask(key: str) -> str:
    """fbl_live_9c2a…4a91 — enough to recognise, not enough to use."""
    if len(key) <= 16:
        return key
    return f"{key[:13]}{'•' * 8}{key[-4:]}"


@router.get("/{institution_id}/credentials")
def credentials(institution_id: str):
    """The institution's own API key, for its settings screen.

    Returns the live key so the console can offer copy-to-clipboard. In
    production this belongs behind a real dashboard session (and most
    providers show the secret once at creation, then only the mask) — the
    demo has no server-side session to gate it on.
    """
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
