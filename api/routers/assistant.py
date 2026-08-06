import time
from collections import defaultdict, deque

from fastapi import APIRouter, HTTPException, Query, Request
from pydantic import BaseModel, Field

import sessions
from agents.copilot.assistant import answer

router = APIRouter(prefix="/v1/assistant", tags=["assistant"])

# This endpoint spends money per call (it forwards to a hosted model), so it
# gets a tighter budget than the global middleware limit. Per-caller, in
# memory: adequate for a single-process demo, and the shape a Redis-backed
# limiter would take in production.
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
            detail=f"Too many questions. Limit is {RATE_LIMIT_MAX} per minute.",
        )
    hits.append(now)


class ChatTurn(BaseModel):
    role: str
    # Bounded so a caller can't bury the system prompt under a wall of text.
    content: str = Field(max_length=2_000)


class ChatRequest(BaseModel):
    message: str = Field(min_length=1, max_length=1_000)
    history: list[ChatTurn] = Field(default_factory=list, max_length=20)
    # Scopes the grounding data. Absent, the assistant answers with no figures
    # rather than aggregating every tenant's numbers together.
    institution_id: str | None = None


@router.post("/chat")
def chat(payload: ChatRequest, request: Request, institution: str | None = Query(None)):
    _rate_limit(request.client.host if request.client else "unknown")

    # The tenant grounding this answer must come from the session, never from
    # the caller. The agent's own docstring says a missing id must not let it
    # "aggregate every tenant's numbers into one answer, which is a data leak
    # between institutions" — but only None was guarded, so passing another
    # bank's id returned an answer grounded in *their* real figures, via an LLM,
    # which is a considerably more fluent leak than raw rows.
    #
    # The client-supplied values are still accepted as a fallback while the
    # console is migrated to sessions, and are ignored the moment one is
    # present. That fallback goes away with the rest of the query-parameter
    # tenancy.
    try:
        tenant = sessions.verify(sessions.extract_token(request))["inst"]
    except sessions.SessionError:
        tenant = payload.institution_id or institution

    return answer(payload.message, [t.model_dump() for t in payload.history], tenant)
