"""Customer balances, top-ups and security factors."""
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field

from core import security
from core.tenancy import customer_guard
from services import accounts as ledger
from services import audit

router = APIRouter(prefix="/v1/accounts", tags=["accounts"], dependencies=[Depends(customer_guard)])


def _sandbox_ledger(request: Request) -> str:
    """The caller's bank, if its balances are Fable's simulated ledger.

    In the sandbox Fable keeps a ledger so the test app has money to move. A
    live bank keeps its customers' balances in its own core banking system, and
    Fable never holds or moves funds, so these endpoints refuse a live bank.
    """
    if request.state.mode == "live":
        raise HTTPException(
            status_code=409,
            detail="Balances are kept by the bank's own systems in live mode. Fable holds no funds.",
        )
    return request.state.institution_id


@router.get("/{user_id}")
def balance(user_id: str, request: Request):
    institution_id = _sandbox_ledger(request)
    return {**ledger.get_balance(user_id, institution_id), "limits": ledger.limits()}


@router.get("/{user_id}/statement")
def statement(user_id: str, request: Request, limit: int = 50):
    _sandbox_ledger(request)
    return {"user_id": user_id, "entries": ledger.statement(user_id, limit)}


class TopUpRequest(BaseModel):
    amount: float = Field(gt=0)
    method: str = "card"
    institution_id: Optional[str] = None
    # Idempotency: a double-tapped button must not credit twice.
    reference: Optional[str] = None


@router.post("/{user_id}/topup")
def topup(user_id: str, payload: TopUpRequest, request: Request):
    institution_id = _sandbox_ledger(request)
    try:
        result = ledger.top_up(
            user_id, payload.amount, institution_id, payload.method, payload.reference
        )
        audit.record(audit.ACCOUNT_TOPUP, user_id, institution_id=institution_id,
                     amount=payload.amount, method=payload.method)
        return result
    except ledger.TopUpRejected as exc:
        raise HTTPException(
            status_code=422,
            detail={
                "error": "topup_rejected",
                "message": str(exc),
                "limit": exc.limit,
                "resets_at": exc.resets_at,
                "limits": ledger.limits(),
            },
        )


# ---------------------------------------------------------------------------
# Security factors the customer controls
# ---------------------------------------------------------------------------

@router.get("/{user_id}/security")
def security_status(user_id: str):
    return security.status(user_id)


class SetPinRequest(BaseModel):
    pin: str = Field(min_length=4, max_length=6)
    # Required once a PIN exists, so a hijacked session can't silently replace
    # the factor that guards the account.
    current_pin: Optional[str] = None
    # With no PIN yet but another factor in place (a passkey or a confirmed
    # email), a step-up token for purpose "security_change".
    stepup_token: Optional[str] = None
    institution_id: Optional[str] = None


@router.post("/{user_id}/security/pin")
def set_pin(user_id: str, payload: SetPinRequest, request: Request):
    from services import notifications

    institution_id = request.state.institution_id
    had_pin = security.status(user_id)["pin_set"]
    try:
        result = security.set_pin(user_id, payload.pin, payload.current_pin, institution_id,
                                  payload.stepup_token)
    except security.SecurityError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    change = "pin_changed" if had_pin else "pin_set"
    audit.record(audit.SECURITY_CHANGED, user_id, institution_id=institution_id, change=change)
    notifications.notify_security_change(user_id, institution_id, change)
    return result


class TwoFactorRequest(BaseModel):
    enabled: bool
    current_pin: Optional[str] = None
    stepup_token: Optional[str] = None


@router.post("/{user_id}/security/two-factor")
def set_two_factor(user_id: str, payload: TwoFactorRequest, request: Request):
    from services import notifications

    try:
        security.require_existing_factor(user_id, payload.current_pin, payload.stepup_token)
    except security.SecurityError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    result = security.set_two_factor(user_id, payload.enabled)
    audit.record(audit.SECURITY_CHANGED, user_id, institution_id=request.state.institution_id,
                 change="two_factor_on" if payload.enabled else "two_factor_off")
    notifications.notify_security_change(user_id, request.state.institution_id, "two_factor_changed")
    return result


class LocationSharingRequest(BaseModel):
    share: bool
    current_pin: Optional[str] = None
    stepup_token: Optional[str] = None


@router.post("/{user_id}/security/location")
def set_location_sharing(user_id: str, payload: LocationSharingRequest, request: Request):
    """The customer chooses whether their location is used. Turning it off
    removes a check (a transfer from a new city is no longer noticed), so it
    needs a factor the customer already has, like the other security settings:
    someone holding only the session cannot switch it off before a transfer."""
    from services import notifications

    if not payload.share:
        try:
            security.require_existing_factor(user_id, payload.current_pin, payload.stepup_token)
        except security.SecurityError as exc:
            raise HTTPException(status_code=400, detail=str(exc))
    result = security.set_location_sharing(user_id, payload.share)
    audit.record(audit.SECURITY_CHANGED, user_id, institution_id=request.state.institution_id,
                 change="location_on" if payload.share else "location_off")
    if not payload.share:
        notifications.notify_security_change(user_id, request.state.institution_id, "location_off")
    return result


class SetContactRequest(BaseModel):
    email: Optional[str] = Field(None, max_length=254)
    phone: Optional[str] = Field(None, max_length=32)
    institution_id: Optional[str] = None
    current_pin: Optional[str] = None
    stepup_token: Optional[str] = None


@router.post("/{user_id}/security/contact")
def set_contact(user_id: str, payload: SetContactRequest, request: Request):
    """Change the customer's contact details.

    A new email is not used until it is confirmed: the response carries a
    `verification` object with the challenge for the code sent to the new
    address, to be completed at /security/contact/verify.
    """
    try:
        result = security.set_contact(
            user_id, payload.email, payload.phone, request.state.institution_id,
            payload.current_pin, payload.stepup_token,
        )
    except security.SecurityError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    audit.record(audit.SECURITY_CHANGED, user_id, institution_id=request.state.institution_id,
                 change="contact_change_started",
                 email_pending=bool(result.get("verification")), phone=bool(payload.phone))
    return result


class ConfirmContactRequest(BaseModel):
    challenge_id: str
    code: str = Field(max_length=12)


@router.post("/{user_id}/security/contact/verify")
def confirm_contact(user_id: str, payload: ConfirmContactRequest, request: Request):
    """Confirm a new email with the code that was sent to it."""
    try:
        result = security.confirm_contact(user_id, payload.challenge_id, payload.code,
                                          request.state.institution_id)
    except security.SecurityError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    audit.record(audit.SECURITY_CHANGED, user_id, institution_id=request.state.institution_id,
                 change="email_confirmed")
    return result
