"""Step-up verification endpoints.

Passkey enrolment and assertion, out-of-band codes, and the question the demo
bank asks before it lets money move: "what does this decision require?".

The server decides what each proof is worth. A token records the factors that
were actually verified and nothing more; what a caller says it needs
(`required_level` on the older request shapes) is accepted for compatibility
and ignored. The tier a transfer or a hold demands is computed from Fable's own
stored decision, never from a score or signals the caller sends.
"""
import logging
from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field

from agents.shield import assurance, stepup
from core.db import cursor, loads, row_to_dict
from core.tenancy import customer_guard

router = APIRouter(prefix="/v1/stepup", tags=["stepup"], dependencies=[Depends(customer_guard)])
logger = logging.getLogger("fable.stepup")

# What a proof can be bound to. "transfer" and "ghost_release" must name the
# transfer or hold they are for; "security_change" guards the customer's own
# security settings and names nothing.
PURPOSES = ("transfer", "ghost_release", "security_change")


def _decision(user_id: str, institution_id: str, purpose: str, reference: str | None) -> dict | None:
    """The stored transfer or hold a proof is for, if it is this customer's."""
    if not reference:
        return None
    with cursor() as cur:
        if purpose == "ghost_release":
            cur.execute("SELECT * FROM ghost_containers WHERE ghost_id = ? AND user_id = ? AND institution_id = ?",
                        (reference, user_id, institution_id))
        else:
            cur.execute("SELECT * FROM transactions WHERE id = ? AND user_id = ? AND institution_id = ?",
                        (reference, user_id, institution_id))
        return row_to_dict(cur.fetchone())


def _check_binding(request: Request, user_id: str, purpose: str, reference: str | None) -> dict | None:
    """Refuse a proof that is not bound to something this customer owns.

    A token minted with no reference used to be accepted for any transfer, so
    a PIN proved for one could approve another. Money-moving proofs must now
    name their transfer or hold, and it must be the customer's own.
    """
    if purpose not in PURPOSES:
        raise HTTPException(status_code=422, detail=f"Unknown purpose '{purpose}'.")
    if purpose == "security_change":
        return None
    if not reference:
        raise HTTPException(status_code=422, detail="Say which transfer or hold this verification is for.")
    row = _decision(user_id, request.state.institution_id, purpose, reference)
    if not row:
        raise HTTPException(status_code=404, detail="Transfer or hold not found.")
    return row


def _parse(iso) -> datetime | None:
    if not iso:
        return None
    try:
        when = datetime.fromisoformat(str(iso).replace(" ", "T"))
    except (TypeError, ValueError):
        return None
    return when if when.tzinfo else when.replace(tzinfo=timezone.utc)


def _required_for(row: dict | None, purpose: str, user_id: str) -> str:
    """The tier the stored decision demands."""
    from core import security

    if row is None:
        return "pin"
    signals = loads(row.get("signals") if purpose == "ghost_release" else row.get("shield_signals"), []) or []
    if purpose == "ghost_release":
        return assurance.release_level(row.get("risk_score") or 0.0, signals)
    always_ask = bool(security.status(user_id).get("two_factor_enabled"))
    return assurance.required_level(row.get("risk_score") or 0.0, signals, row.get("action_taken"),
                                    always_ask=always_ask)


def _available_factors(user_id: str, cutoff: datetime | None) -> dict:
    """Which factors this customer can use, honouring the hold's cutoff."""
    from core import security

    st = security.status(user_id)
    pin_ok = bool(st.get("pin_set"))
    email_ok = bool(st.get("email_set"))
    if cutoff is not None or email_ok:
        enrolled = {}
        if pin_ok:
            enrolled["pin"] = stepup.factor_enrolled_at(user_id, "pin")
        if email_ok:
            enrolled["otp"] = stepup.factor_enrolled_at(user_id, "otp")
        _, late = stepup.factors_predate(enrolled, cutoff, user_id)
        pin_ok = pin_ok and "pin" not in late
        email_ok = email_ok and "otp" not in late
    return {
        "pin": pin_ok,
        "otp": email_ok,
        "passkey": stepup.has_passkey(user_id, before=cutoff),
    }


def steps_for(level: str, have: dict) -> list[str] | None:
    """The factors to collect for `level`, given what the customer has.
    None when the customer has no combination that reaches it."""
    if level == "none":
        return []
    if level in ("pin", "otp"):
        if have["pin"]:
            return ["pin"]
        if have["otp"]:
            return ["otp"]
        if have["passkey"]:
            return ["passkey"]
        return ["pin"]  # first factor: the customer chooses a PIN
    if level == "passkey":
        if have["passkey"]:
            return ["passkey"]
        return ["pin", "otp"] if have["pin"] and have["otp"] else None
    if level == "passkey_and_otp":
        if have["passkey"] and have["otp"]:
            return ["passkey", "otp"]
        if not have["passkey"] and have["pin"] and have["otp"]:
            return ["pin", "otp"]
        return None
    if level == "identity_check":
        return ["passkey", "pin", "otp"] if all(have.values()) else None
    return None


# ---------------------------------------------------------------------------
# What does this decision require?
# ---------------------------------------------------------------------------

class RequirementRequest(BaseModel):
    user_id: str
    purpose: str = "transfer"          # 'transfer' | 'ghost_release'
    # The transfer id (purpose "transfer") or hold id (purpose "ghost_release").
    # When present the tier comes from Fable's stored decision.
    reference: Optional[str] = None
    # Deprecated: used only when no reference is given, and never trusted for
    # anything that moves money (approval and release recompute it).
    risk_score: float = 0.0
    signals: list[str] = Field(default_factory=list)
    action: Optional[str] = None


@router.post("/requirement")
def requirement(payload: RequirementRequest, request: Request):
    from core import security

    cutoff = None
    if payload.reference:
        row = _check_binding(request, payload.user_id, payload.purpose, payload.reference)
        level = _required_for(row, payload.purpose, payload.user_id)
        if payload.purpose == "ghost_release":
            cutoff = _parse(row.get("created_at"))
        source = "stored_decision"
    else:
        always_ask = bool(security.status(payload.user_id).get("two_factor_enabled"))
        if payload.purpose == "ghost_release":
            level = assurance.release_level(payload.risk_score, payload.signals)
        else:
            level = assurance.required_level(
                payload.risk_score, payload.signals, payload.action, always_ask=always_ask
            )
        source = "caller_supplied"

    have = _available_factors(payload.user_id, cutoff)
    steps = steps_for(level, have)
    info = assurance.describe(level)
    return {
        "level": level,
        **info,
        "source": source,
        # The factors to collect, in order, worked out from what this customer
        # actually has. Empty when nothing is needed; null when no combination
        # they have reaches the tier, in which case only cancelling is open.
        "steps": steps,
        "available": steps is not None,
        "passkey_registered": stepup.has_passkey(payload.user_id),
        "recent_failures": stepup.recent_failure_count(payload.user_id),
    }


# ---------------------------------------------------------------------------
# Passkey enrolment
# ---------------------------------------------------------------------------

class RegisterBeginRequest(BaseModel):
    user_id: str
    display_name: str = Field(max_length=120)
    institution_id: Optional[str] = None
    # Enrolling a device is a security-settings change: it must be authorised
    # by a factor the customer already has (their PIN, or a step-up token for
    # purpose "security_change"), so a session-riding attacker can't add and
    # trust their phone.
    current_pin: Optional[str] = None
    stepup_token: Optional[str] = None


@router.post("/passkey/register/begin")
def passkey_register_begin(payload: RegisterBeginRequest, request: Request):
    from core import security

    try:
        security.require_existing_factor(payload.user_id, payload.current_pin, payload.stepup_token)
    except security.SecurityError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    return stepup.begin_registration(payload.user_id, payload.display_name, request.state.institution_id)


class RegisterCompleteRequest(BaseModel):
    user_id: str
    challenge_id: str
    credential: dict
    device_label: Optional[str] = Field(None, max_length=60)
    institution_id: Optional[str] = None
    # The browser fingerprint of the device the passkey is being enrolled on,
    # so it can be trusted for the device-anomaly signal.
    device_fingerprint: Optional[str] = Field(None, max_length=200)


@router.post("/passkey/register/complete")
def passkey_register_complete(payload: RegisterCompleteRequest, request: Request):
    from services import notifications

    try:
        result = stepup.complete_registration(
            payload.user_id, payload.challenge_id, payload.credential,
            payload.device_label, request.state.institution_id, payload.device_fingerprint,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    notifications.notify_security_change(payload.user_id, request.state.institution_id, "passkey_added")
    return result


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
def passkey_auth_begin(payload: AuthBeginRequest, request: Request):
    _check_binding(request, payload.user_id, payload.purpose, payload.reference)
    try:
        return stepup.begin_authentication(payload.user_id, payload.purpose, payload.reference)
    except LookupError as exc:
        raise HTTPException(status_code=404, detail=str(exc))


class AuthCompleteRequest(BaseModel):
    user_id: str
    challenge_id: str
    credential: dict
    # Deprecated and advisory. When it says "passkey_and_otp" the response
    # sets next="otp" as a hint; the token always records a passkey, because a
    # passkey is what was proved.
    required_level: str = "passkey"


@router.post("/passkey/auth/complete")
def passkey_auth_complete(payload: AuthCompleteRequest):
    try:
        result = stepup.complete_authentication(payload.user_id, payload.challenge_id, payload.credential)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))

    token = stepup.issue_token(payload.user_id, "passkey", result["purpose"], result["reference"],
                               factors={"passkey": result.get("enrolled_at")})
    wants_code = payload.required_level == "passkey_and_otp"
    return {
        "verified": True,
        **token,
        # The same token under its own name, to hand to /otp/verify as
        # passkey_token when a code must follow.
        "passkey_token": token["token"],
        "next": "otp" if wants_code else None,
        "purpose": result["purpose"],
        "reference": result["reference"],
    }


# ---------------------------------------------------------------------------
# Out-of-band code
# ---------------------------------------------------------------------------

class OtpSendRequest(BaseModel):
    user_id: str
    institution_id: Optional[str] = None
    # Deprecated and ignored: a code only ever goes to the customer's own
    # registered, confirmed email. Letting the caller name the address meant
    # an attacker could send the "out-of-band" code to themselves.
    email: Optional[str] = None
    channel: str = "email"  # "email"; "sms" is not available
    purpose: str = "transfer"
    reference: Optional[str] = None


@router.post("/otp/send")
def otp_send(payload: OtpSendRequest, request: Request):
    from core import security

    _check_binding(request, payload.user_id, payload.purpose, payload.reference)
    if payload.email:
        logger.warning("otp/send ignored a caller-supplied email; codes go to the registered address only.")
    if payload.channel == "sms":
        raise HTTPException(
            status_code=400,
            detail={"error": "sms_unavailable",
                    "message": "Codes by SMS aren't available yet. We can send one to your registered email."},
        )

    email = security.get_contact(payload.user_id).get("email")
    if not email:
        raise HTTPException(
            status_code=400,
            detail="No email registered for codes. Add one in Security, or verify another way.",
        )
    try:
        return stepup.send_otp(payload.user_id, payload.purpose, payload.reference, email=email)
    except stepup.OtpDeliveryFailed as exc:
        # Undeliverable means the factor was not issued. 502 rather than 400:
        # the caller did nothing wrong, our delivery channel did.
        raise HTTPException(
            status_code=502,
            detail={"error": "otp_undeliverable", "message": str(exc)},
        )


class OtpVerifyRequest(BaseModel):
    user_id: str
    challenge_id: str
    code: str = Field(max_length=12)
    # A passkey token from /passkey/auth/complete for the same transfer or
    # hold. With it, the code completes the combined passkey_and_otp tier.
    passkey_token: Optional[str] = None
    # Deprecated and ignored: the level is what was proved.
    required_level: str = "pin"


@router.post("/otp/verify")
def otp_verify(payload: OtpVerifyRequest):
    try:
        result = stepup.verify_otp(payload.user_id, payload.challenge_id, payload.code)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    if result["purpose"] == "contact_verify":
        raise HTTPException(status_code=400, detail="Confirm a new email from the Security screen.")

    factors = {"otp": stepup.factor_enrolled_at(payload.user_id, "otp")}
    if payload.passkey_token:
        info = stepup.token_info(payload.passkey_token, payload.user_id, result["purpose"], result["reference"])
        if not info or "passkey" not in info["factors"] or not stepup.consume_token(payload.passkey_token):
            raise HTTPException(status_code=400, detail="Confirm on your device again, then enter a new code.")
        factors.update(info["factors"])

    level = assurance.level_for_factors(set(factors), stepup.has_passkey(payload.user_id))
    token = stepup.issue_token(payload.user_id, level, result["purpose"], result["reference"], factors=factors)
    return {"verified": True, **token}


class PinVerifyRequest(BaseModel):
    user_id: str
    pin: str = Field(max_length=12)
    purpose: str = "transfer"
    reference: Optional[str] = None
    # Deprecated and ignored.
    required_level: str = "pin"


@router.post("/pin/verify")
def pin_verify(payload: PinVerifyRequest, request: Request):
    """A real factor: hashed, rate-limited, locked after repeated failures."""
    from core import security

    _check_binding(request, payload.user_id, payload.purpose, payload.reference)
    try:
        ok = security.check_pin(payload.user_id, payload.pin)
    except security.SecurityError as exc:
        raise HTTPException(status_code=400, detail=str(exc))

    if not ok:
        raise HTTPException(status_code=400, detail="That PIN isn't right.")

    token = stepup.issue_token(payload.user_id, "pin", payload.purpose, payload.reference,
                               factors={"pin": stepup.factor_enrolled_at(payload.user_id, "pin")})
    return {"verified": True, **token}


# ---------------------------------------------------------------------------
# Composed check
# ---------------------------------------------------------------------------

class IdentityCheckRequest(BaseModel):
    user_id: str
    purpose: str = "ghost_release"
    reference: Optional[str] = None
    # Proof that each part was completed.
    passkey_token: Optional[str] = None
    pin_token: Optional[str] = None
    otp_token: Optional[str] = None


@router.post("/identity-check")
def identity_check(payload: IdentityCheckRequest, request: Request):
    """Combine separately verified factors into one proof.

    This is not a liveness or ID-document check: Fable has no KYC vendor. It
    takes the tokens the customer earned one factor at a time and issues a
    single token whose level is exactly what those factors add up to (see
    assurance.level_for_factors). Nothing is counted that was set up after the
    money was held, and a code counts only if it went to an email that has
    been on the account for the settle window: those are the factors an
    attacker holding the session can create for themselves.
    """
    from core import config

    if getattr(config, "KYC_PROVIDER_URL", ""):
        # A provider is configured; the composed fallback does not apply.
        raise HTTPException(
            status_code=501,
            detail=(
                "KYC provider configured but not yet wired. Expected contract: "
                "POST {user_id, selfie} -> {match: bool, confidence: float, reference: str}."
            ),
        )

    row = _check_binding(request, payload.user_id, payload.purpose, payload.reference)
    cutoff = _parse(row.get("created_at")) if (row and payload.purpose == "ghost_release") else None

    supplied = [t for t in (payload.passkey_token, payload.pin_token, payload.otp_token) if t]
    proven: dict = {}
    for token in supplied:
        info = stepup.token_info(token, payload.user_id, payload.purpose, payload.reference)
        if info:
            proven.update(info["factors"])
    ok, late = stepup.factors_predate(proven, cutoff, payload.user_id)
    for name in late:
        proven.pop(name, None)

    level = assurance.level_for_factors(set(proven), stepup.has_passkey(payload.user_id, before=cutoff))
    required = _required_for(row, payload.purpose, payload.user_id) if row else "pin"
    if not assurance.satisfies(level, required):
        raise HTTPException(
            status_code=400,
            detail={
                "error": "factors_incomplete",
                "message": (
                    "A factor set up after this transfer was held can't release it. You can still cancel it."
                    if late else "More verification is needed for this."
                ),
                "proven": sorted(proven),
                "not_counted": late,
                "level": level,
                "required": required,
            },
        )

    # Each part is spent, so the same tokens cannot be replayed.
    for token in supplied:
        stepup.consume_token(token)

    _label = {"passkey": "device unlock", "pin": "PIN", "otp": "a one-time code"}
    used = " and ".join(_label.get(name, name) for name in sorted(proven))
    issued = stepup.issue_token(payload.user_id, level, payload.purpose, payload.reference, factors=proven)
    return {
        "verified": True,
        "method": "composed_factors",
        "note": f"Verified with {used}. This is a check of your own factors, not an ID or liveness check.",
        **issued,
    }
