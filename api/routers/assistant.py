import json

from fastapi import APIRouter, Query, Request
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field

from agents.copilot.assistant import Options, answer, opening_questions, stream
from core.tenancy import require_role
from services import assistant_controls as controls

router = APIRouter(prefix="/v1/assistant", tags=["assistant"])

# Shown under an answer that came from the figures because of a limit.
_NOTICES = {
    "off": "AI answers are switched off for your institution, so this comes straight from your figures.",
    "budget": "Your institution has used today's AI answers, so this comes straight from your figures. "
              "AI answers return at midnight, Lagos time.",
}


class ChatTurn(BaseModel):
    role: str
    # Bounded so a caller can't bury the system prompt under a wall of text.
    content: str = Field(max_length=4_000)


class ChatRequest(BaseModel):
    message: str = Field(min_length=1, max_length=1_000)
    history: list[ChatTurn] = Field(default_factory=list, max_length=40)
    # Follow-ups already shown in this conversation, so they aren't offered again.
    shown: list[str] = Field(default_factory=list, max_length=60)


def _prepare(request: Request) -> tuple[dict, Options]:
    """Who is asking, after the per-person limits, and what this answer may spend.

    The bank grounding the answer comes from the caller's credential and
    nothing else; a bank named in the body or query is never read. The limits
    are counted per person, not per IP: behind the proxy every console user can
    share one address.
    """
    who = require_role(request, "viewer")
    who = {**who, "email": who.get("email") or who["role"]}
    cfg = controls.settings()
    controls.check_person(who["inst"], who["email"], cfg)
    allowed, reason = controls.model_allowance(who["inst"], cfg)
    return who, Options(
        use_model=allowed,
        max_output_tokens=cfg["max_output_tokens"],
        max_history_turns=cfg["max_history_turns"],
        max_question_chars=cfg["max_question_chars"],
        cache_minutes=cfg["cache_minutes"],
        notice=_NOTICES.get(reason),
    )


def _meter(who: dict, usage: dict | None) -> None:
    u = usage or {}
    controls.record(who["inst"], who["email"], model=bool(u.get("model")), cached=bool(u.get("cached")),
                    input_tokens=u.get("input_tokens", 0), output_tokens=u.get("output_tokens", 0))


@router.post("/chat")
def chat(payload: ChatRequest, request: Request):
    who, opts = _prepare(request)
    result = answer(payload.message, [t.model_dump() for t in payload.history], who["inst"], payload.shown, opts)
    _meter(who, result.pop("usage", None))
    return result


@router.post("/chat/stream")
def chat_stream(payload: ChatRequest, request: Request):
    """The same answer as /chat, as server-sent events while it is written."""
    who, opts = _prepare(request)
    history = [t.model_dump() for t in payload.history]

    def events():
        try:
            for event in stream(payload.message, history, who["inst"], payload.shown, opts):
                if event["type"] == "done":
                    _meter(who, event.pop("usage", None))
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
