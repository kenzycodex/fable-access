"""Institution registry.

The demo bank calls this to validate the institution slug in its URL
(/demo/{institution}) and to render the tenant's name and customer roster.
"""
from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel

import audit
import security
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


def _customer_belongs(institution_id: str, user_id: str) -> bool:
    """Is this customer one of the institution's own?

    Checked across every place a customer can first appear, because an account
    row only exists after a first balance read and a transaction only after a
    first transfer, while the roster is the one thing a freshly provisioned
    tenant always has.
    """
    roster = {c["user_id"] for c in customers_for_institution(institution_id)}
    if user_id in roster:
        return True
    with cursor() as cur:
        for table in ("accounts", "fable_users", "transactions"):
            cur.execute(
                f"SELECT 1 FROM {table} WHERE user_id = ? AND institution_id = ? LIMIT 1",
                (user_id, institution_id),
            )
            if cur.fetchone():
                return True
    return False


@router.post("/{institution_id}/customers/{user_id}/pin/reset")
def reset_customer_pin(institution_id: str, user_id: str, request: Request):
    """Clear a customer's transaction PIN so they can choose a new one.

    What a bank does at a branch or on a support call for a customer who has
    forgotten theirs. It deletes the PIN rather than setting one, so the
    institution never learns or picks a customer's PIN: the customer chooses a
    new one the next time a verification asks for it.

    Needs a console session for this institution. Another tenant's session, or
    a customer who is not yours, is a 404 so the endpoint cannot be used to
    probe which customers or institutions exist.
    """
    try:
        payload = sessions.verify(sessions.extract_token(request))
    except sessions.SessionError as exc:
        raise HTTPException(status_code=401, detail=str(exc))

    if payload["inst"] != institution_id or not _customer_belongs(institution_id, user_id):
        raise HTTPException(status_code=404, detail="Customer not found")

    status = security.clear_pin(user_id)
    audit.record(audit.SECURITY_CHANGED, user_id, institution_id=institution_id,
                 change="pin_reset", via="institution", admin=payload["sub"])
    return status
