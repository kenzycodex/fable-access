from fastapi import APIRouter

from models.schemas import FeedbackRequest
from agents.copilot.transparency import get_transparency_data

router = APIRouter(prefix="/v1/copilot", tags=["copilot"])


@router.get("/transparency/{user_id}")
def transparency(user_id: str):
    return get_transparency_data(user_id)
