"""Plain-language explanation generator for Shield decisions.

Provider order: Anthropic Claude → OpenAI GPT-4o → deterministic local
template. Whichever key is configured wins; with neither key set the local
template is used so the API keeps working (Shield's "never fail open" rule
extends to its own dependencies — a missing or erroring LLM must never break
the risk decision).
"""
from config import (
    ANTHROPIC_API_KEY,
    ANTHROPIC_MODEL,
    OPENAI_API_KEY,
    OPENAI_MODEL,
)

SYSTEM_PROMPT = """You are Fable Shield, an AI fraud-prevention layer for Nigerian banks.
Write a short explanation (max 80 words) of why a transaction was flagged or blocked.
Rules:
- Plain English, no jargon, no technical signal names verbatim.
- Never blame or scold the user.
- Be specific: reference the actual amount multiplier, recipient novelty, timing, or scam pattern given.
- Reassure the user their money is safe when action is BLOCK or FLAG.
- End with confidence, not fear."""

# Lazily-initialized provider clients — built once at import so a missing SDK
# or key simply leaves the client None and we fall through to the next provider.
_anthropic_client = None
if ANTHROPIC_API_KEY:
    try:
        import anthropic
        _anthropic_client = anthropic.Anthropic(api_key=ANTHROPIC_API_KEY)
    except Exception:
        _anthropic_client = None

_openai_client = None
if OPENAI_API_KEY:
    try:
        from openai import OpenAI
        _openai_client = OpenAI(api_key=OPENAI_API_KEY)
    except Exception:
        _openai_client = None


def generate_explanation(signals: list[str], amount: float, action: str) -> str:
    if action == "PASS":
        return _local_pass_explanation(signals)

    user_prompt = (
        f"Action taken: {action}\n"
        f"Amount: NGN {amount:,.0f}\n"
        f"Signals detected: {', '.join(signals) if signals else 'none'}\n"
        "Write the explanation now."
    )

    text = _try_anthropic(user_prompt) or _try_openai(user_prompt)
    if text:
        return text

    return _local_block_flag_explanation(signals, amount, action)


def _try_anthropic(user_prompt: str) -> str | None:
    if not _anthropic_client:
        return None
    try:
        # claude-opus-4-8: no temperature / budget_tokens params (removed on
        # 4.7+). This is a short generation task, so no extended thinking.
        resp = _anthropic_client.messages.create(
            model=ANTHROPIC_MODEL,
            max_tokens=160,
            system=SYSTEM_PROMPT,
            messages=[{"role": "user", "content": user_prompt}],
        )
        text = "".join(block.text for block in resp.content if block.type == "text").strip()
        return text or None
    except Exception:
        return None  # never fail the request over an explainer error


def _try_openai(user_prompt: str) -> str | None:
    if not _openai_client:
        return None
    try:
        resp = _openai_client.chat.completions.create(
            model=OPENAI_MODEL,
            temperature=0.3,
            max_tokens=160,
            messages=[
                {"role": "system", "content": SYSTEM_PROMPT},
                {"role": "user", "content": user_prompt},
            ],
        )
        text = (resp.choices[0].message.content or "").strip()
        return text or None
    except Exception:
        return None


def _local_pass_explanation(signals: list[str]) -> str:
    return "This transfer matches your usual habits, so it went through instantly with no extra checks."


def _local_block_flag_explanation(signals: list[str], amount: float, action: str) -> str:
    reasons = []
    for s in signals:
        key = s.split(":")[0]
        if key == "amount_anomaly":
            reasons.append("the amount is much larger than what you usually send")
        elif key == "new_recipient":
            reasons.append("you've never sent money to this recipient before")
        elif key == "time_anomaly":
            reasons.append("this is happening outside the hours you're normally active")
        elif key == "channel_risk":
            reasons.append("this channel carries a higher fraud risk")
        elif key.startswith("nip_"):
            reasons.append("the payment network itself flagged this recipient")
        elif key == "scam_pattern":
            reasons.append("the message matches patterns used in common Nigerian scams")

    reason_text = ", and ".join(reasons) if reasons else "several unusual signals were detected together"
    verb = "blocked" if action == "BLOCK" else "flagged for your review"

    return (
        f"This transfer of ₦{amount:,.0f} was {verb} because {reason_text}. "
        "Your money is safe and has not left your account."
    )
