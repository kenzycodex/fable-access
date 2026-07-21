"""Plain-language explanation generator for Shield decisions.

The explanation is prose *about* a decision, not part of it. It used to be
generated inline, which put a multi-second GPT-4o round trip inside the scored
request: the verdict was ready in ~50ms and then sat waiting on a paragraph.
That is the wrong trade for a layer sitting in a payment path, so the call now
happens off the request path and the caller is handed something useful
immediately.

Three tiers, fastest first:

1. **Cache** — an identical decision shape has been explained before. Returned
   synchronously, no network.
2. **Template** — deterministic prose assembled from the signals. Always
   available, always instant, and correct if less fluent.
3. **LLM** — Anthropic Claude, then OpenAI GPT-4o. Generated in the background
   and collected later; the result populates the cache for everyone after.

Shield's "never fail open" rule extends to its own dependencies: a missing,
slow, or erroring provider must never change or delay a risk decision.
"""
import re
import time

from config import (
    ANTHROPIC_API_KEY,
    ANTHROPIC_MODEL,
    EXPLAINER_TIMEOUT_SECONDS,
    OPENAI_API_KEY,
    OPENAI_MODEL,
)

SYSTEM_PROMPT = """You are Fable Shield, an AI fraud-prevention layer for Nigerian banks.
Write a short explanation (max 80 words) of why a transaction was flagged or blocked.
Rules:
- Plain English, no jargon, no technical signal names verbatim.
- Never blame or scold the user.
- Be specific about WHY: reference the recipient's novelty, the timing, the channel, the scam pattern, or how far outside their normal the amount sits.
- Do NOT state the exact naira figure. The screen already shows it. Refer to the amount qualitatively ("much larger than usual") or by its multiple ("about 8 times your normal").
- Reassure the user their money is safe when action is BLOCK or FLAG.
- End with confidence, not fear."""

# Lazily-initialized provider clients — built once at import so a missing SDK
# or key simply leaves the client None and we fall through to the next provider.
_anthropic_client = None
if ANTHROPIC_API_KEY:
    try:
        import anthropic
        _anthropic_client = anthropic.Anthropic(
            api_key=ANTHROPIC_API_KEY, timeout=EXPLAINER_TIMEOUT_SECONDS
        )
    except Exception:
        _anthropic_client = None

_openai_client = None
if OPENAI_API_KEY:
    try:
        from openai import OpenAI
        _openai_client = OpenAI(api_key=OPENAI_API_KEY, timeout=EXPLAINER_TIMEOUT_SECONDS)
    except Exception:
        _openai_client = None


def llm_available() -> bool:
    """Whether a better explanation than the template could be generated."""
    return bool(_anthropic_client or _openai_client)


# ---------------------------------------------------------------------------
# Cache signature
# ---------------------------------------------------------------------------

# Amount-anomaly tiers, matching the boost tiers in analyzer.py. A 5x deviation
# and a 45x deviation deserve different prose; a 5x and a 6x do not.
_MULTIPLIER_TIERS = (50, 25, 10, 5)


def _amount_tier(signal: str) -> str:
    """"amount_anomaly: 45x above your baseline (+0.4)" -> "amount_anomaly@25"."""
    match = re.search(r"(\d+)x", signal)
    if not match:
        return "amount_anomaly"
    mult = int(match.group(1))
    for tier in _MULTIPLIER_TIERS:
        if mult >= tier:
            return f"amount_anomaly@{tier}"
    return "amount_anomaly@0"


def signal_signature(signals: list[str], action: str) -> str:
    """A stable key for the *shape* of a decision.

    Built from signal keys rather than whole signal strings, because those
    carry per-transaction detail (exact multiples, city names, weights) that
    would make almost every signature unique and the cache useless. The prompt
    forbids quoting the exact amount for the same reason: prose keyed on the
    decision shape must not contain a figure belonging to one transaction.
    """
    keys = []
    for signal in signals:
        key = signal.split(":")[0].strip()
        keys.append(_amount_tier(signal) if key == "amount_anomaly" else key)
    return f"{action}|{'|'.join(sorted(set(keys)))}"


def cached_explanation(signature: str) -> str | None:
    """Look up a previously generated explanation, counting the hit."""
    from db import cursor

    try:
        with cursor() as cur:
            cur.execute(
                "SELECT explanation FROM explanation_cache WHERE signature = ?", (signature,)
            )
            row = cur.fetchone()
            if not row:
                return None
            cur.execute(
                "UPDATE explanation_cache SET hits = hits + 1 WHERE signature = ?", (signature,)
            )
            return row["explanation"]
    except Exception:
        return None  # a cache problem must never affect a decision


def store_explanation(signature: str, action: str, explanation: str) -> None:
    from db import cursor

    try:
        with cursor() as cur:
            cur.execute(
                """INSERT INTO explanation_cache (signature, action, explanation)
                   VALUES (?, ?, ?)
                   ON CONFLICT(signature) DO UPDATE SET explanation = excluded.explanation""",
                (signature, action, explanation),
            )
    except Exception:
        pass


# ---------------------------------------------------------------------------
# Generation
# ---------------------------------------------------------------------------


def explain_now(signals: list[str], amount: float, action: str) -> tuple[str, str]:
    """The best explanation obtainable without a network call.

    Returns (explanation, source). Never raises, never blocks on a provider.
    """
    if action == "PASS":
        return _local_pass_explanation(signals), "template"

    signature = signal_signature(signals, action)
    hit = cached_explanation(signature)
    if hit:
        return hit, "cache"

    return _local_block_flag_explanation(signals, amount, action), "template"


def generate_llm_explanation(signals: list[str], amount: float, action: str) -> tuple[str | None, float]:
    """Call a provider for polished prose. Returns (text or None, elapsed_ms).

    Intended to run off the request path. On success the result is cached, so
    the next decision with this shape resolves synchronously.
    """
    if action == "PASS" or not llm_available():
        return None, 0.0

    started = time.perf_counter()
    user_prompt = (
        f"Action taken: {action}\n"
        f"Amount: NGN {amount:,.0f}\n"
        f"Signals detected: {', '.join(signals) if signals else 'none'}\n"
        "Write the explanation now."
    )

    text = _try_anthropic(user_prompt) or _try_openai(user_prompt)
    elapsed_ms = round((time.perf_counter() - started) * 1000, 2)

    if text:
        store_explanation(signal_signature(signals, action), action, text)
    return text, elapsed_ms


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
        elif key == "device_anomaly":
            reasons.append("this device isn't one you normally use")
        elif key == "location_anomaly":
            reasons.append("this is coming from somewhere you don't usually transact")
        elif key == "cold_start":
            reasons.append("this account is still new to us")
        elif key == "failed_verification":
            reasons.append("recent identity checks on this account did not pass")
        elif key == "session_freshness":
            reasons.append("the transfer came moments after signing in")
        elif key == "behavioral_anomaly":
            reasons.append("the transfer was entered unusually quickly")
        elif key == "timezone_mismatch":
            reasons.append("the device's clock is set to an unfamiliar region")

    reason_text = ", and ".join(reasons) if reasons else "several unusual signals were detected together"
    verb = "blocked" if action == "BLOCK" else "flagged for your review"

    return (
        f"This transfer of ₦{amount:,.0f} was {verb} because {reason_text}. "
        "Your money is safe and has not left your account."
    )


def generate_explanation(signals: list[str], amount: float, action: str) -> str:
    """Backwards-compatible synchronous entry point.

    Prefers cache, falls back to the template. Retained so callers outside the
    Shield request path (Ghost, scripts) keep working unchanged; it no longer
    blocks on a provider.
    """
    return explain_now(signals, amount, action)[0]
