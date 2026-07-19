"""Step-up verification endpoints.

Passkey enrolment and assertion, out-of-band codes, and the question the demo
bank asks before it lets money move: "what does this decision require?".
"""
from typing import Optional

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from agents.shield import assurance, stepup
from tenancy import get_institution

router = APIRouter(prefix="/v1/stepup", tags=["stepup"])


# ---------------------------------------------------------------------------
# What does this decision require?
# ---------------------------------------------------------------------------

class RequirementRequest(BaseModel):
    user_id: str
    risk_score: float = 0.0
    signals: list[str] = Field(default_factory=list)
    action: Optional[str] = None
    purpose: str = "transfer"          # 'transfer' | 'ghost_release'


@router.post("/requirement")
def requirement(payload: RequirementRequest):
    if payload.purpose == "ghost_release":
        level = assurance.release_level(payload.risk_score, payload.signals)
    else:
        level = assurance.required_level(payload.risk_score, payload.signals, payload.action)

    info = assurance.describe(level)
    return {
        "level": level,
        **info,
        "passkey_registered": stepup.has_passkey(payload.user_id),
        "recent_failures": stepup.recent_failure_count(payload.user_id),
    }


# ---------------------------------------------------------------------------
# Passkey enrolment
# ---------------------------------------------------------------------------

class RegisterBeginRequest(BaseModel):
    user_id: str
    display_name: str
    institution_id: Optional[str] = None


@router.post("/passkey/register/begin")
def passkey_register_begin(payload: RegisterBeginRequest):
    return stepup.begin_registration(payload.user_id, payload.display_name, payload.institution_id)


class RegisterCompleteRequest(BaseModel):
    user_id: str
    challenge_id: str
    credential: dict
    device_label: Optional[str] = None
    institution_id: Optional[str] = None


@router.post("/passkey/register/complete")
def passkey_register_complete(payload: RegisterCompleteRequest):
    try:
        return stepup.complete_registration(
            payload.user_id, payload.challenge_id, payload.credential,
            payload.device_label, payload.institution_id,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))


@router.get("/passkey/{user_id}")
def passkey_status(user_id: str):
    return {
        "user_id": user_id,
        "registered": stepup.has_passkey(user_id),
        "credentials": stepup.list_credentials(user_id),
    }


# ---------------------------------------------------------------------------
# Passkey assertion
# ---------------------------------------------------------------------------

class AuthBeginRequest(BaseModel):
    user_id: str
    purpose: str = "transfer"
    reference: Optional[str] = None


@router.post("/passkey/auth/begin")
def passkey_auth_begin(payload: AuthBeginRequest):
    try:
        return stepup.begin_authentication(payload.user_id, payload.purpose, payload.reference)
    except LookupError as exc:
        raise HTTPException(status_code=404, detail=str(exc))


class AuthCompleteRequest(BaseModel):
    user_id: str
    challenge_id: str
    credential: dict
    # When the required level needs a second factor, the caller says so and we
    # withhold the token until the code is verified too.
    required_level: str = "passkey"


@router.post("/passkey/auth/complete")
def passkey_auth_complete(payload: AuthCompleteRequest):
    try:
        result = stepup.complete_authentication(payload.user_id, payload.challenge_id, payload.credential)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))

    if payload.required_level == "passkey_and_otp":
        # Biometric alone doesn't satisfy this tier — the point is a second,
        # out-of-band channel, so no token is issued yet.
        return {
            "verified": True,
            "level": "passkey",
            "token": None,
            "next": "otp",
            "purpose": result["purpose"],
            "reference": result["reference"],
        }

    token = stepup.issue_token(payload.user_id, "passkey", result["purpose"], result["reference"])
    return {"verified": True, "level": "passkey", **token, "next": None}


# ---------------------------------------------------------------------------
# Out-of-band code
# ---------------------------------------------------------------------------

class OtpSendRequest(BaseModel):
    user_id: str
    institution_id: Optional[str] = None
    email: Optional[str] = None
    purpose: str = "transfer"
    reference: Optional[str] = None


@router.post("/otp/send")
def otp_send(payload: OtpSendRequest):
    # A real deployment reads the customer's registered address from the core
    # banking record. The demo falls back to the institution's contact address,
    # which is the closest thing it genuinely has.
    email = payload.email
    if not email and payload.institution_id:
        inst = get_institution(payload.institution_id)
        email = (inst or {}).get("contact_email")
    if not email:
        raise HTTPException(status_code=400, detail="No registered address to send a code to.")

    return stepup.send_otp(payload.user_id, email, payload.purpose, payload.reference)


class OtpVerifyRequest(BaseModel):
    user_id: str
    challenge_id: str
    code: str
    # The level being satisfied; a code following a passkey completes the
    # combined tier rather than standing alone.
    required_level: str = "pin"


@router.post("/otp/verify")
def otp_verify(payload: OtpVerifyRequest):
    try:
        result = stepup.verify_otp(payload.user_id, payload.challenge_id, payload.code)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))

    level = "passkey_and_otp" if payload.required_level == "passkey_and_otp" else "pin"
    token = stepup.issue_token(payload.user_id, level, result["purpose"], result["reference"])
    return {"verified": True, "level": level, **token}


# ---------------------------------------------------------------------------
# Identity check (vendor tier)
# ---------------------------------------------------------------------------

@router.post("/identity-check")
def identity_check():
    """The liveness/face tier.

    Deliberately not implemented: a real check runs against the customer's
    KYC selfie through a provider (Smile ID, Dojah, Prembly). Faking it would
    make the strongest tier the least trustworthy, so this returns 501 with
    the contract a provider would fulfil.
    """
    raise HTTPException(
        status_code=501,
        detail=(
            "Identity verification requires a KYC provider (Smile ID / Dojah / Prembly). "
            "Expected contract: POST {user_id, selfie} -> {match: bool, confidence: float, "
            "reference: str}. Wire a provider here to enable the identity_check tier."
        ),
    )
