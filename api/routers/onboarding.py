"""The go-live checklist, and the owner's confirmation of the agreements."""
from fastapi import APIRouter, Request
from pydantic import BaseModel

from core.db import cursor
from core.tenancy import require_role
from services import audit, onboarding

router = APIRouter(prefix="/v1/onboarding", tags=["onboarding"])


@router.get("")
def checklist(request: Request):
    return onboarding.checklist(require_role(request, "viewer")["inst"])


class Agreements(BaseModel):
    data_processing_agreement: bool
    dpia: bool


@router.post("/agreements")
def confirm_agreements(body: Agreements, request: Request):
    """An owner confirms the data processing agreement is signed and the data
    protection impact assessment is done. Both are required to go live."""
    who = require_role(request, "owner")
    if not (body.data_processing_agreement and body.dpia):
        from fastapi import HTTPException

        raise HTTPException(status_code=400, detail="Confirm both the agreement and the DPIA.")
    with cursor() as cur:
        cur.execute(
            """UPDATE institutions SET agreements_confirmed_at = datetime('now'), agreements_confirmed_by = ?
               WHERE institution_id = ?""",
            (who["email"], who["inst"]),
        )
    audit.record(audit.AGREEMENTS_CONFIRMED, None, institution_id=who["inst"], by=who["email"])
    return onboarding.checklist(who["inst"])
