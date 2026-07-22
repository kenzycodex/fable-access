"""Customer balances, top-ups and security factors."""
from typing import Optional

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel, Field

import accounts as ledger
import security
from tenancy import resolve_institution

router = APIRouter(prefix="/v1/accounts", tags=["accounts"])


@router.get("/{user_id}")
def balance(user_id: str, institution: Optional[str] = None):
    return {**ledger.get_balance(user_id, institution), "limits": ledger.limits()}


@router.get("/{user_id}/statement")
def statement(user_id: str, limit: int = 50):
    return {"user_id": user_id, "entries": ledger.statement(user_id, limit)}


class TopUpRequest(BaseModel):
    amount: float = Field(gt=0)
    method: str = "card"
    institution_id: Optional[str] = None
    # Idempotency: a double-tapped button must not credit twice.
    reference: Optional[str] = None


@router.post("/{user_id}/topup")
def topup(user_id: str, payload: TopUpRequest, request: Request):
    institution_id = resolve_institution(request, payload.institution_id)
    try:
        return ledger.top_up(
            user_id, payload.amount, institution_id, payload.method, payload.reference
        )
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
    try:
        return security.set_pin(user_id, payload.pin, payload.current_pin, payload.institution_id)
    except security.SecurityError as exc:
        raise HTTPException(status_code=400, detail=str(exc))


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
