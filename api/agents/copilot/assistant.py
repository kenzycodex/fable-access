"""Fable Copilot — the institution analyst assistant.

A natural-language chat for a bank's risk/fraud team: "what's my biggest scam
threat this week?", "why was that ₦500k transfer blocked?", "how much fraud
did Fable prevent?". Answers are grounded in the institution's real numbers
(pulled from the DB, never invented).

Provider order: OpenAI GPT-4o -> Anthropic Claude -> deterministic answer built
from the same numbers. With no key configured the deterministic path keeps the
assistant useful (Shield's "never fail open" rule extends to the assistant).
"""
from config import (
    ANTHROPIC_API_KEY,
    ANTHROPIC_MODEL,
    OPENAI_API_KEY,
    OPENAI_MODEL,
)
from intelligence.context import (
    channel_breakdown,
    institution_summary,
    scam_pattern_breakdown,
    grounding_text,
)

SYSTEM_PROMPT = """You are Fable Copilot, an AI analyst embedded in a Nigerian bank's fraud-operations console.
You help risk and compliance staff understand fraud activity across their customers.

Rules:
- Answer in plain, confident English. Be specific and concise (max ~120 words).
- Ground every number in the INSTITUTION DATA provided. Never invent figures; if the data doesn't cover it, say so.
- You understand Nigerian fraud context: NIBSS/NIP rails, Pidgin scam scripts, USSD/POS channel risk, BVN/NIN.
- When useful, recommend a concrete next action (review a channel, tighten a rule, brief a team).
- Never expose customer PII beyond what a fraud analyst would already see."""

# Lazily-initialized clients — a missing SDK or key leaves the client None and
# we fall through to the next provider.
_openai_client = None
if OPENAI_API_KEY:
    try:
        from openai import OpenAI
        _openai_client = OpenAI(api_key=OPENAI_API_KEY)
    except Exception:
        _openai_client = None

_anthropic_client = None
if ANTHROPIC_API_KEY:
    try:
        import anthropic
        _anthropic_client = anthropic.Anthropic(api_key=ANTHROPIC_API_KEY)
    except Exception:
        _anthropic_client = None


def answer(message: str, history: list[dict] | None = None) -> dict:
    """Return {reply, engine} for an analyst question, grounded in real data."""
    history = history or []
    grounding = grounding_text()
    system = f"{SYSTEM_PROMPT}\n\nINSTITUTION DATA (live):\n{grounding}"

    reply = _try_openai(system, history, message)
    if reply:
        return {"reply": reply, "engine": "openai"}

    reply = _try_anthropic(system, history, message)
    if reply:
        return {"reply": reply, "engine": "anthropic"}

    return {"reply": _deterministic(message), "engine": "deterministic"}


def _try_openai(system: str, history: list[dict], message: str) -> str | None:
    if not _openai_client:
        return None
    try:
        messages = [{"role": "system", "content": system}]
        for turn in history[-6:]:
            role = "assistant" if turn.get("role") == "assistant" else "user"
            messages.append({"role": role, "content": str(turn.get("content", ""))})
        messages.append({"role": "user", "content": message})
        resp = _openai_client.chat.completions.create(
            model=OPENAI_MODEL,
            temperature=0.3,
            max_tokens=400,
            messages=messages,
        )
        return (resp.choices[0].message.content or "").strip() or None
    except Exception:
        return None


def _try_anthropic(system: str, history: list[dict], message: str) -> str | None:
    if not _anthropic_client:
        return None
    try:
        # claude-opus-4-8: no temperature / budget_tokens params. Short chat
        # task, so adaptive thinking is left off (default on 4.8).
        messages = []
        for turn in history[-6:]:
            role = "assistant" if turn.get("role") == "assistant" else "user"
            messages.append({"role": role, "content": str(turn.get("content", ""))})
        messages.append({"role": "user", "content": message})
        resp = _anthropic_client.messages.create(
            model=ANTHROPIC_MODEL,
            max_tokens=400,
            system=system,
            messages=messages,
        )
        return "".join(b.text for b in resp.content if b.type == "text").strip() or None
    except Exception:
        return None


def _deterministic(message: str) -> str:
    """Rule-based analyst answer from the real numbers — used when no LLM key
    is set, so the assistant is still genuinely useful in the demo."""
    s = institution_summary()
    q = message.lower()
    patterns = scam_pattern_breakdown()
    channels = channel_breakdown()

    if any(w in q for w in ("prevent", "saved", "money", "loss", "how much")):
        return (
            f"Fable has prevented roughly ₦{s['fraud_prevented_ngn']:,.0f} in fraud so far — "
            f"money customers reached for after a scam, held in Ghost and cancelled before it left. "
            f"{s['blocked']} transfers were blocked outright and {s['flagged']} more flagged for review."
        )
    if any(w in q for w in ("scam", "pattern", "threat", "biggest")):
        if patterns:
            top = patterns[0]
            return (
                f"Your biggest scam vector is \"{top['label']}\" ({top['count']} hits), "
                f"followed by " + ", ".join(f"{p['label']} ({p['count']})" for p in patterns[1:4]) + ". "
                "These are Pidgin/English social-engineering scripts Shield matches on the narration."
            )
        return "No scam patterns have fired yet in this dataset."
    if any(w in q for w in ("channel", "ussd", "pos", "web")):
        if channels:
            riskiest = max(channels, key=lambda c: c["risk_rate"])
            return (
                f"By volume, {channels[0]['label']} leads ({channels[0]['total']} transfers). "
                f"The riskiest channel is {riskiest['label']} at {int(riskiest['risk_rate']*100)}% flagged/blocked — "
                "worth a tighter rule or step-up verification."
            )
        return "No channel activity recorded yet."
    if any(w in q for w in ("block", "why", "flag")):
        return (
            "Shield blocks a transfer when its combined risk score crosses 0.8 — usually an amount far above the "
            "customer's baseline, a brand-new recipient, a higher-risk channel like USSD, and a narration that "
            "matches a known Nigerian scam script. Each decision carries the exact signals that fired."
        )
    return (
        f"Across {s['transactions_analyzed']} analyzed transfers, Fable blocked {s['blocked']} and flagged "
        f"{s['flagged']}, preventing about ₦{s['fraud_prevented_ngn']:,.0f} in fraud. "
        "Ask me about your top scam patterns, riskiest channels, or why a specific transfer was blocked."
    )
