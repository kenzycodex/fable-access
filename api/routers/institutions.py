"""Institution registry.

The demo bank calls this to validate the institution slug in its URL
(/demo/{institution}) and to render the tenant's name and customer roster.
"""
from fastapi import APIRouter, HTTPException

from tenancy import get_institution, list_institutions
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
    return {**inst, "customers": customers_for_institution(institution_id)}
