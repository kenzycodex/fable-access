"""The operator console's integration keys (see services/secret_admin.py).

Every response is marked no-store. Every change needs a platform owner and a
fresh step-up (passkey preferred, authenticator code accepted). Request
bodies here are never logged, and no endpoint ever returns a key's value.
"""
import time
from collections import defaultdict, deque

from fastapi import APIRouter, Depends, HTTPException, Request, Response
from pydantic import BaseModel, Field

from core import operator_stepup, operators
from services import secret_admin

RATE_MAX = 10
_hits: dict[str, deque] = defaultdict(deque)


def _no_store(response: Response) -> None:
    response.headers["Cache-Control"] = "no-store"
    response.headers["Pragma"] = "no-cache"


router = APIRouter(prefix="/operator", tags=["operator-secrets"], dependencies=[Depends(_no_store)])


def _limited(op: dict) -> None:
    now = time.monotonic()
    hits = _hits[op["email"]]
    while hits and now - hits[0] > 60:
        hits.popleft()
    if len(hits) >= RATE_MAX:
        raise HTTPException(status_code=429, detail="Too many key actions. Wait a minute.")
    hits.append(now)


def _owner(request: Request) -> dict:
    op = operators.require(request, "platform_owner")
    _limited(op)
    return op


class StepUp(BaseModel):
    code: str | None = Field(None, max_length=12)
    challenge_id: str | None = Field(None, max_length=80)
    passkey: dict | None = None


class Propose(BaseModel):
    value: str = Field(min_length=1, max_length=512)
    reason: str = Field(min_length=5, max_length=300)
    rotation: str = "routine"
    note: str | None = Field(None, max_length=200)
    step_up: StepUp


class BatchItem(BaseModel):
    name: str = Field(max_length=64)
    value: str = Field(min_length=1, max_length=512)
    rotation: str = "routine"
    note: str | None = Field(None, max_length=200)


class Batch(BaseModel):
    items: list[BatchItem] = Field(min_length=1, max_length=25)
    reason: str = Field(min_length=5, max_length=300)
    step_up: StepUp


class Decide(BaseModel):
    step_up: StepUp | None = None
    reason: str | None = Field(None, max_length=300)


class Rollback(BaseModel):
    version: int = Field(ge=1)
    reason: str = Field(min_length=5, max_length=300)
    step_up: StepUp


class Remove(BaseModel):
    reason: str = Field(min_length=5, max_length=300)
    step_up: StepUp


@router.get("/secrets")
def list_secrets(request: Request):
    """What is configured, where it comes from, versions and pending changes. Never a value."""
    op = operators.require(request, "support")
    out = secret_admin.overview()
    out["me"] = {
        "can_change": op.get("role") == "platform_owner",
        "passkeys": len(operator_stepup.passkeys(op["email"])),
        "locked_until": operator_stepup.locked_until(op["email"]),
    }
    return out


@router.post("/secrets/stepup")
def step_up_options(request: Request):
    """The factors this owner can confirm with, and a passkey challenge if they have one."""
    op = _owner(request)
    return operator_stepup.options(op)


@router.post("/secrets/{name}/propose")
def propose(name: str, body: Propose, request: Request):
    op = _owner(request)
    operator_stepup.verify(op, body.step_up.model_dump())
    return secret_admin.propose(op, name, body.value, body.reason.strip(), body.rotation, body.note)


@router.post("/secrets/batch")
def propose_batch(body: Batch, request: Request):
    """Several variables at once (the Add dialog, or a pasted .env), under one step-up."""
    op = _owner(request)
    operator_stepup.verify(op, body.step_up.model_dump())
    return {"changes": secret_admin.propose_many(op, [i.model_dump() for i in body.items], body.reason.strip())}


@router.post("/secrets/{name}/rollback")
def rollback(name: str, body: Rollback, request: Request):
    op = _owner(request)
    operator_stepup.verify(op, body.step_up.model_dump())
    return secret_admin.propose_rollback(op, name, body.version, body.reason.strip())


@router.post("/secrets/{name}/remove")
def remove(name: str, body: Remove, request: Request):
    op = _owner(request)
    operator_stepup.verify(op, body.step_up.model_dump())
    return secret_admin.propose_removal(op, name, body.reason.strip())


@router.post("/secrets/changes/{change_id}/approve")
def approve(change_id: str, body: Decide, request: Request):
    op = _owner(request)
    operator_stepup.verify(op, body.step_up.model_dump() if body.step_up else None)
    return secret_admin.approve(op, change_id)


@router.post("/secrets/changes/{change_id}/reject")
def reject(change_id: str, body: Decide, request: Request):
    """Reject (another owner) or cancel (the proposer). No step-up: stopping a
    change must be quick, and it can only ever leave things as they are."""
    op = _owner(request)
    return secret_admin.reject(op, change_id, (body.reason or "").strip() or None)


@router.post("/secrets/{name}/test")
def test(name: str, request: Request):
    op = operators.require(request, "platform_admin")
    _limited(op)
    return secret_admin.test_active(op, name)


class TestSend(BaseModel):
    to: str = Field(min_length=3, max_length=254)


@router.post("/integrations/test-email")
def test_email(body: TestSend, request: Request):
    """Send a test email with the mail settings in force, to check them end to
    end. Audited; the response never contains a setting's value."""
    from services import audit, mailer

    op = operators.require(request, "platform_admin")
    _limited(op)
    if "@" not in body.to:
        raise HTTPException(status_code=422, detail="Enter an email address.")
    if not mailer.configured():
        return {"sent": False, "message": "Mail isn't set up: add the mail username and password first."}
    sent = mailer.send(body.to, "Fable test email",
                       "This is a test email from the Fable operator console. Mail is set up correctly.")
    audit.record("platform.test_email", None, operator=op["email"], sent=sent)
    return {"sent": sent, "message": "Sent. Check the inbox." if sent else "The mail server refused it. Check the settings."}


@router.post("/integrations/test-sms")
def test_sms(body: TestSend, request: Request):
    """Send a test SMS through the configured provider. Audited."""
    from services import audit, sms

    op = operators.require(request, "platform_admin")
    _limited(op)
    if not sms.configured():
        return {"sent": False, "message": "SMS isn't set up: choose a provider and add its API key first."}
    result = sms.send(body.to, "This is a test SMS from the Fable operator console.")
    audit.record("platform.test_sms", None, operator=op["email"], sent=result.sent)
    return {"sent": result.sent,
            "message": "Sent. Check the phone." if result.sent else f"The provider did not accept it ({result.detail})."}


# ── Operator passkeys ────────────────────────────────────────────────────────

class PasskeyFinish(BaseModel):
    challenge_id: str = Field(max_length=80)
    credential: dict
    label: str | None = Field(None, max_length=60)


@router.get("/passkeys")
def my_passkeys(request: Request):
    op = operators.current(request)
    return {"passkeys": operator_stepup.passkeys(op["email"])}


@router.post("/passkeys/register")
def passkey_options(request: Request):
    op = operators.current(request)
    _limited(op)
    return operator_stepup.begin_passkey_registration(op)


@router.post("/passkeys/register/finish")
def passkey_finish(body: PasskeyFinish, request: Request):
    op = operators.current(request)
    made = operator_stepup.complete_passkey_registration(op, body.challenge_id, body.credential, body.label)
    secret_admin.log_event("operator.passkey_added", actor=op["email"], detail={"label": made["label"]})
    return made


@router.post("/passkeys/{credential_id}/remove")
def passkey_remove(credential_id: str, body: Decide, request: Request):
    op = operators.current(request)
    _limited(op)
    operator_stepup.verify(op, body.step_up.model_dump() if body.step_up else None)
    operator_stepup.remove_passkey(op, credential_id)
    secret_admin.log_event("operator.passkey_removed", actor=op["email"], detail={"credential": credential_id[:8]})
    return {"removed": credential_id}
