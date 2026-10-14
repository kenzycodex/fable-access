from fastapi import APIRouter, Depends

from agents.copilot.transparency import get_transparency_data
from core.tenancy import customer_scope

router = APIRouter(prefix="/v1/copilot", tags=["copilot"], dependencies=[Depends(customer_scope)])


@router.get("/transparency/{user_id}")
def transparency(user_id: str):
    return get_transparency_data(user_id)
