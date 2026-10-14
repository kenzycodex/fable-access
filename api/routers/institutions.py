"""Institution registry.

The demo bank calls this to validate the institution slug in its URL
(/demo/{institution}) and to render the tenant's name and customer roster.
"""
import re
from typing import Optional

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel

from agents.copilot.demo_customers import customers_for_institution
from core import security, sessions
from core.db import cursor
from core.tenancy import get_institution, institution_from_api_key, institution_mode, list_institutions, require_role
from services import audit

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
            """SELECT key_prefix, key_last4, created_at FROM api_keys
               WHERE institution_id = ? AND is_active = 1
               ORDER BY created_at DESC LIMIT 1""",
            (institution_id,),
        )
        row = cur.fetchone()

    is_owner = require_role(request, "viewer")["role"] == "owner"
    mode = institution_mode(institution_id)
    if not row:
        return {"institution_id": institution_id, "api_key": None, "masked_key": None,
                "created_at": None, "mode": mode, "can_manage": is_owner}

    from core import apikeys

    return {
        "institution_id": institution_id,
        # Never the key itself: only a hash is stored, so there is nothing to
        # return. The full key is shown once, when it is issued or rotated.
        "api_key": None,
        "masked_key": apikeys.mask(row["key_prefix"], row["key_last4"]),
        "created_at": row["created_at"],
        "mode": mode,
        "can_manage": is_owner,
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
    require_role(request, "analyst")

    status = security.clear_pin(user_id)
    audit.record(audit.SECURITY_CHANGED, user_id, institution_id=institution_id,
                 change="pin_reset", via="institution", admin=payload["sub"])
    return status


_EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")


class InstitutionPatch(BaseModel):
    name: Optional[str] = None
    type: Optional[str] = None
    contact_email: Optional[str] = None


@router.patch("/{institution_id}")
def update_institution(institution_id: str, patch: InstitutionPatch, request: Request):
    """Edit the institution's own profile: name, type and contact address.

    Needs a console session for this institution; another tenant's session gets
    a 404 so the endpoint cannot be used to probe which institutions exist.

    What it deliberately does not touch:

    * `institution_id`. It is the tenant key every customer, transfer and API key
      hangs off, and it is not derived from the name after provisioning, so
      renaming never orphans anything.
    * The console login email. `contact_email` is where the institution can be
      reached; signing in is a separate credential (`admins.email`).
    * The public demo URL. That is the branding slug, with its own cooling period.
    """
    try:
        payload = sessions.verify(sessions.extract_token(request))
    except sessions.SessionError as exc:
        raise HTTPException(status_code=401, detail=str(exc))

    if payload["inst"] != institution_id or not get_institution(institution_id):
        raise HTTPException(status_code=404, detail="Institution not found")
    require_role(request, "owner")

    updates: dict[str, str] = {}

    if patch.name is not None:
        name = " ".join(patch.name.split())
        if not 2 <= len(name) <= 80:
            raise HTTPException(status_code=400, detail="The institution name must be 2 to 80 characters.")
        updates["name"] = name

    if patch.type is not None:
        kind = " ".join(patch.type.split())
        if not 2 <= len(kind) <= 60:
            raise HTTPException(status_code=400, detail="The type must be 2 to 60 characters.")
        updates["type"] = kind

    if patch.contact_email is not None:
        email = patch.contact_email.strip().lower()
        if not _EMAIL_RE.match(email) or len(email) > 120:
            raise HTTPException(status_code=400, detail="That doesn't look like a valid email address.")
        updates["contact_email"] = email

    if not updates:
        raise HTTPException(status_code=400, detail="Nothing to change.")

    with cursor() as cur:
        sets = ", ".join(f"{column} = ?" for column in updates)
        cur.execute(f"UPDATE institutions SET {sets} WHERE institution_id = ?", (*updates.values(), institution_id))
        # Keep the provisioning record's display name in step with the profile.
        if "name" in updates:
            cur.execute(
                "UPDATE api_keys SET institution_name = ? WHERE institution_id = ?",
                (updates["name"], institution_id),
            )

    audit.record(
        audit.INSTITUTION_UPDATED, payload["sub"], institution_id=institution_id,
        fields=sorted(updates), name=updates.get("name"), type=updates.get("type"),
    )
    return get_institution(institution_id)


def _own_institution(institution_id: str, request: Request, minimum: str) -> dict:
    """The caller, if they belong to this institution and hold `minimum`. 404 otherwise."""
    who = require_role(request, minimum)
    if who["inst"] != institution_id or not get_institution(institution_id):
        raise HTTPException(status_code=404, detail="Institution not found")
    return who


@router.get("/{institution_id}/settings")
def get_settings(institution_id: str, request: Request):
    """The risk policy in force: base cutoffs and Ghost hold windows."""
    from services import policy

    _own_institution(institution_id, request, "viewer")
    return {"policy": policy.effective(institution_id), "defaults": policy.defaults(),
            "mode": institution_mode(institution_id)}


class SettingsPatch(BaseModel):
    flag_threshold: Optional[float] = None
    block_threshold: Optional[float] = None
    hold_high_minutes: Optional[int] = None
    hold_medium_minutes: Optional[int] = None
    hold_low_minutes: Optional[int] = None
    # Field names listed here are reset to Fable's default.
    reset: list[str] = []


@router.put("/{institution_id}/settings")
def put_settings(institution_id: str, body: SettingsPatch, request: Request):
    from services import policy

    who = _own_institution(institution_id, request, "owner")
    changes = {k: v for k, v in body.model_dump(exclude={"reset"}).items() if v is not None}
    for k in body.reset:
        if k in policy.defaults():
            changes[k] = None
    before = policy.effective(institution_id)
    try:
        after = policy.update(institution_id, changes, who["email"])
    except policy.PolicyError as exc:
        raise HTTPException(status_code=422, detail=str(exc))
    diff = {k: {"from": before[k], "to": after[k]} for k in policy.defaults() if before[k] != after[k]}
    if diff:
        audit.record(audit.POLICY_CHANGED, None, institution_id=institution_id, changes=diff, by=who["email"])
    return {"policy": after, "defaults": policy.defaults(), "mode": institution_mode(institution_id)}


@router.post("/{institution_id}/keys/rotate")
def rotate_key(institution_id: str, request: Request):
    """Issue a new API key and retire the old one, immediately.

    There is no overlap window: a key being rotated is usually a key that
    leaked, and keeping it alive "for a migration period" is exactly what an
    attacker holding it would want. The new key is returned once.
    """
    from core import apikeys

    who = _own_institution(institution_id, request, "owner")
    inst = get_institution(institution_id)
    new_key = apikeys.generate()
    with cursor() as cur:
        cur.execute("UPDATE api_keys SET is_active = 0 WHERE institution_id = ?", (institution_id,))
        apikeys.insert(cur, new_key, institution_id, inst["name"], who["email"])
    audit.record(audit.KEY_ROTATED, None, institution_id=institution_id, by=who["email"], key=_mask(new_key))
    return {"institution_id": institution_id, "api_key": new_key, "masked_key": _mask(new_key)}


class ModePatch(BaseModel):
    mode: str


@router.put("/{institution_id}/mode")
def set_mode(institution_id: str, body: ModePatch, request: Request):
    """Switch between sandbox (open, for the demo bank) and live (key required)."""
    who = _own_institution(institution_id, request, "owner")
    if body.mode not in ("sandbox", "live"):
        raise HTTPException(status_code=400, detail="mode must be sandbox or live.")
    with cursor() as cur:
        cur.execute("UPDATE institutions SET mode = ? WHERE institution_id = ?", (body.mode, institution_id))
    audit.record(audit.MODE_CHANGED, None, institution_id=institution_id, mode=body.mode, by=who["email"])
    return {"institution_id": institution_id, "mode": body.mode}
