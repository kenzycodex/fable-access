import json
import time
from collections import defaultdict, deque

from fastapi import APIRouter, HTTPException, Query, Request
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field

from agents.copilot.assistant import answer, opening_questions, stream
from core.tenancy import require_role

router = APIRouter(prefix="/v1/assistant", tags=["assistant"])

# Each question can spend money (it forwards to a hosted model), so it gets a
# tighter budget than the global limit. Counted per signed-in person, not per
# IP: behind the proxy every console user can share one address, and one busy
# analyst used to exhaust the budget for their whole bank. In memory, which
# fits a single process; a shared store is the shape for several.
RATE_LIMIT_MAX = 20
RATE_LIMIT_WINDOW_SECONDS = 60
_calls: dict[str, deque] = defaultdict(deque)


def _rate_limit(key: str) -> None:
    now = time.monotonic()
    hits = _calls[key]
    while hits and now - hits[0] > RATE_LIMIT_WINDOW_SECONDS:
        hits.popleft()
    if len(hits) >= RATE_LIMIT_MAX:
        raise HTTPException(
            status_code=429,
            detail=f"That's a lot of questions at once. The limit is {RATE_LIMIT_MAX} a minute; try again shortly.",
        )
    hits.append(now)


class ChatTurn(BaseModel):
    role: str
    # Bounded so a caller can't bury the system prompt under a wall of text.
    content: str = Field(max_length=4_000)


class ChatRequest(BaseModel):
    message: str = Field(min_length=1, max_length=1_000)
    history: list[ChatTurn] = Field(default_factory=list, max_length=40)
    # Follow-ups already shown in this conversation, so they aren't offered again.
    shown: list[str] = Field(default_factory=list, max_length=60)


def _caller(request: Request) -> str:
    """The bank grounding the answer comes from the caller's credential and
    nothing else. A bank named in the body or query is never read."""
    who = require_role(request, "viewer")
    _rate_limit(f"{who['inst']}:{who.get('email') or who['role']}")
    return who["inst"]


@router.post("/chat")
def chat(payload: ChatRequest, request: Request):
    tenant = _caller(request)
    return answer(payload.message, [t.model_dump() for t in payload.history], tenant, payload.shown)


@router.post("/chat/stream")
def chat_stream(payload: ChatRequest, request: Request):
    """The same answer as /chat, as server-sent events while it is written."""
    tenant = _caller(request)
    history = [t.model_dump() for t in payload.history]

    def events():
        try:
            for event in stream(payload.message, history, tenant, payload.shown):
                yield f"data: {json.dumps(event, ensure_ascii=False)}\n\n"
        except Exception:  # noqa: BLE001 - the client gets a clean ending, never a hung stream
            yield f"data: {json.dumps({'type': 'error', 'message': 'Something went wrong. Try again.'})}\n\n"

    return StreamingResponse(
        events(),
        media_type="text/event-stream",
        # Proxies must pass each piece straight through rather than buffer it.
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


@router.get("/starters")
def starter_questions(request: Request, page: str | None = Query(None, max_length=24)):
    """Opening questions drawn from this institution's data, led by the page in view."""
    return {"questions": opening_questions(require_role(request, "viewer")["inst"], page)}
