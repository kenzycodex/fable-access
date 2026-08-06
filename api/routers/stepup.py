"""Step-up verification endpoints.

Passkey enrolment and assertion, out-of-band codes, and the question the demo
bank asks before it lets money move: "what does this decision require?".
"""
from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from agents.shield import assurance, stepup

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
    import security

    # The customer's own "always ask" preference. Stored and shown on the
    # security screen since it was built, and read by nothing until now.
    always_ask = bool(security.status(payload.user_id).get("two_factor_enabled"))

    if payload.purpose == "ghost_release":
        level = assurance.release_level(payload.risk_score, payload.signals)
    else:
        level = assurance.required_level(
            payload.risk_score, payload.signals, payload.action, always_ask=always_ask
        )

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
    # Enrolling a device is a security-settings change: gated by the PIN once
    # one exists, so a session-riding attacker can't add and trust their phone.
    current_pin: Optional[str] = None


@router.post("/passkey/register/begin")
def passkey_register_begin(payload: RegisterBeginRequest):
    import security

    try:
        security.require_pin_if_set(payload.user_id, payload.current_pin)
    except security.SecurityError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    return stepup.begin_registration(payload.user_id, payload.display_name, payload.institution_id)


class RegisterCompleteRequest(BaseModel):
    user_id: str
    challenge_id: str
    credential: dict
    device_label: Optional[str] = None
    institution_id: Optional[str] = None
    # The browser fingerprint of the device the passkey is being enrolled on,
    # so it can be trusted for the device-anomaly signal.
    device_fingerprint: Optional[str] = None


@router.post("/passkey/register/complete")
def passkey_register_complete(payload: RegisterCompleteRequest):
    try:
        return stepup.complete_registration(
            payload.user_id, payload.challenge_id, payload.credential,
            payload.device_label, payload.institution_id, payload.device_fingerprint,
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
    channel: str = "email"  # "email" | "sms"
    purpose: str = "transfer"
    reference: Optional[str] = None


@router.post("/otp/send")
def otp_send(payload: OtpSendRequest):
    import security

    contact = security.get_contact(payload.user_id)

    try:
        return _send_otp(payload, contact)
    except stepup.OtpDeliveryFailed as exc:
        # Undeliverable means the factor was not issued. 502 rather than 400:
        # the caller did nothing wrong, our delivery channel did.
        raise HTTPException(
            status_code=502,
            detail={"error": "otp_undeliverable", "message": str(exc)},
        )


def _send_otp(payload: OtpSendRequest, contact: dict):
    if payload.channel == "sms":
        phone = contact.get("phone")
        if not phone:
            raise HTTPException(status_code=400, detail="No phone number registered for codes.")
        return stepup.send_otp(
            payload.user_id, payload.purpose, payload.reference, phone=phone, channel="sms",
        )

    # Only the customer's own registered address. There is no institution
    # fallback: sending the customer's verification code to the bank's fraud
    # inbox was nonsensical and confusing. If they haven't registered a contact,
    # say so — the client offers a factor that doesn't need one instead.
    email = payload.email or contact.get("email")
    if not email:
        raise HTTPException(
            status_code=400,
            detail="No email registered for codes. Add one in Security, or verify another way.",
        )

    return stepup.send_otp(payload.user_id, payload.purpose, payload.reference, email=email)


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


class PinVerifyRequest(BaseModel):
    user_id: str
    pin: str
    purpose: str = "transfer"
    reference: Optional[str] = None
    required_level: str = "pin"


@router.post("/pin/verify")
def pin_verify(payload: PinVerifyRequest):
    """A real factor: hashed, rate-limited, locked after repeated failures."""
    import security

    try:
        ok = security.check_pin(payload.user_id, payload.pin)
    except security.SecurityError as exc:
        raise HTTPException(status_code=400, detail=str(exc))

    if not ok:
        raise HTTPException(status_code=400, detail="That PIN isn't right.")

    # A PIN alone satisfies the pin tier, and is one part of the composed tier.
    # Either way the token records what was actually proved, which is a PIN.
    # (This was a ternary whose branches were identical.)
    token = stepup.issue_token(payload.user_id, "pin", payload.purpose, payload.reference)
    return {"verified": True, "level": level, **token}


# ---------------------------------------------------------------------------
# Identity check
# ---------------------------------------------------------------------------

class IdentityCheckRequest(BaseModel):
    user_id: str
    purpose: str = "ghost_release"
    reference: Optional[str] = None
    # Proof that each part of the composed tier was completed.
    passkey_token: Optional[str] = None
    pin_token: Optional[str] = None
    otp_token: Optional[str] = None


def _predates(iso: str | None, cutoff: "datetime | None") -> bool:
    """Was this factor in place before the container was created?

    No cutoff means this is not a containment release, so recency does not
    apply and every factor counts. A factor with no recorded timestamp is
    treated as pre-existing: it predates the column being added, so refusing it
    would lock out customers for a schema change rather than a security event.
    """
    if cutoff is None or not iso:
        return True
    try:
        when = datetime.fromisoformat(str(iso))
    except (TypeError, ValueError):
        return True
    if when.tzinfo is None:
        when = when.replace(tzinfo=timezone.utc)
    return when < cutoff


def _containment_created_at(purpose: str, reference: str | None) -> "datetime | None":
    """When the Ghost container being released was created."""
    if purpose != "ghost_release" or not reference:
        return None
    from agents.ghost.account import get_ghost_container

    container = get_ghost_container(reference)
    if not container or not container.get("created_at"):
        return None
    try:
        created = datetime.fromisoformat(str(container["created_at"]))
    except (TypeError, ValueError):
        return None
    return created.replace(tzinfo=timezone.utc) if created.tzinfo is None else created


@router.post("/identity-check")
def identity_check(payload: IdentityCheckRequest):
    """The strongest tier.

    A liveness check runs against the customer's KYC selfie through a provider
    (Smile ID, Dojah, Prembly). No provider is configured here, and faking a
    face match would make the strongest tier the least trustworthy — so with
    no vendor the tier resolves to the strongest combination actually
    available: a device-bound passkey, a PIN, and a code delivered
    out-of-band. Three independent factors is a defensible substitute; a
    pretend face match is not.
    """
    import config

    if getattr(config, "KYC_PROVIDER_URL", ""):
        # A provider is configured; the composed fallback does not apply.
        raise HTTPException(
            status_code=501,
            detail=(
                "KYC provider configured but not yet wired. Expected contract: "
                "POST {user_id, selfie} -> {match: bool, confidence: float, reference: str}."
            ),
        )

    # Prove every factor you have, up to two. Two independent factors — a strong
    # "something you have/are" plus a second — is the defensible substitute for a
    # liveness check, and more than that is friction a real bank doesn't ask.
    # But a customer who has only set up one factor can't produce two, and must
    # not be stranded with money in containment: for them, that one factor is
    # the bar. So the requirement is min(2, factors they actually have).
    import security

    # A factor enrolled *after* the money was contained does not count.
    #
    # Bootstrapping the first factor is allowed by design (there is nothing yet
    # to prove), and the composed tier counts whatever the customer has. Those
    # two rules combined were a complete bypass: an attacker holding the session
    # of a customer with no PIN, no passkey and no registered contact could set
    # a PIN inline on the release screen, which raised `available` from 0 to 1,
    # which set `required` to 1, and then satisfy it with the PIN they had just
    # chosen. Every factor the model demanded was one the attacker could create.
    #
    # The fix is recency, not difficulty: a credential that did not exist when
    # the transfer was flagged proves nothing about who the customer is, so it
    # is excluded from this decision. Cancelling remains free and unaffected, so
    # a genuine customer with no factors is never stranded — the safe direction
    # stays open, only the money-moving one is closed.
    cutoff = _containment_created_at(payload.purpose, payload.reference)
    st = security.status(payload.user_id)

    factors = {
        "passkey": stepup.has_passkey(payload.user_id, before=cutoff),
        "pin": bool(st.get("pin_set")) and _predates(st.get("pin_set_at"), cutoff),
        "otp": bool(st.get("email_set") or st.get("phone_set")),
    }
    available = sum(1 for ok in factors.values() if ok)
    required = max(1, min(2, available))

    supplied = {
        "passkey": payload.passkey_token,
        "pin": payload.pin_token,
        "otp": payload.otp_token,
    }
    verified = {
        name: bool(stepup.verify_token(token, payload.user_id, payload.purpose, payload.reference))
        # A token for a factor that postdates the hold is not counted even if it
        # verifies, so enrolling one mid-flow cannot help.
        and factors.get(name, False)
        for name, token in supplied.items()
        if token
    }
    proven = [name for name, ok in verified.items() if ok]

    if len(proven) < required:
        raise HTTPException(
            status_code=400,
            detail={
                "error": "factors_incomplete",
                "message": f"{required} verification factor(s) required.",
                "verified": verified,
                "proven": proven,
                "required": required,
                "substitute_for": "liveness_check",
            },
        )

    # Each part is spent, so the same tokens cannot be replayed.
    for token in supplied.values():
        if token:
            stepup.consume_token(token)

    _label = {"passkey": "device unlock", "pin": "PIN", "otp": "a one-time code"}
    factors = " and ".join(_label.get(name, name) for name in proven)
    issued = stepup.issue_token(payload.user_id, "identity_check", payload.purpose, payload.reference)
    return {
        "verified": True,
        "level": "identity_check",
        "method": "composed_factors",
        "note": f"Verified with {factors} in place of a vendor liveness check.",
        **issued,
    }
