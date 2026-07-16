from fastapi import APIRouter
from pydantic import BaseModel

from agents.copilot.assistant import answer

router = APIRouter(prefix="/v1/assistant", tags=["assistant"])


class ChatTurn(BaseModel):
    role: str
    content: str


class ChatRequest(BaseModel):
    message: str
    history: list[ChatTurn] = []


@router.post("/chat")
def chat(payload: ChatRequest):
    result = answer(payload.message, [t.model_dump() for t in payload.history])
    return result
