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
    institution_id: Optional[str] = None


@router.post("/{user_id}/security/pin")
def set_pin(user_id: str, payload: SetPinRequest):
    had_pin = security.status(user_id)["pin_set"]
    try:
        result = security.set_pin(user_id, payload.pin, payload.current_pin, payload.institution_id)
    except security.SecurityError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    audit.record(audit.SECURITY_CHANGED, user_id, institution_id=payload.institution_id,
                 change="pin_changed" if had_pin else "pin_set")
    return result


class TwoFactorRequest(BaseModel):
    enabled: bool
    current_pin: Optional[str] = None


@router.post("/{user_id}/security/two-factor")
def set_two_factor(user_id: str, payload: TwoFactorRequest):
    try:
        security.require_pin_if_set(user_id, payload.current_pin)
    except security.SecurityError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    return security.set_two_factor(user_id, payload.enabled)


class SetContactRequest(BaseModel):
    email: Optional[str] = None
    phone: Optional[str] = None
    institution_id: Optional[str] = None
    current_pin: Optional[str] = None


@router.post("/{user_id}/security/contact")
def set_contact(user_id: str, payload: SetContactRequest):
    try:
        return security.set_contact(
            user_id, payload.email, payload.phone, payload.institution_id, payload.current_pin
        )
    except security.SecurityError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
