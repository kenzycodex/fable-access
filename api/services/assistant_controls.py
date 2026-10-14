"""How much Ask Fable may do, and what it has done: limits, cost and usage.

Every question costs money when a model answers it, so the limits are the
ones a production LLM integration needs, and operators change them from the
operator console rather than a deploy:

  * a per-person rate (questions a minute) and a per-person daily allowance,
    both hard limits that return 429;
  * a per-institution daily budget of *model* answers. When it runs out the
    assistant keeps answering from the institution's figures alone, with no
    model and no cost, rather than going silent;
  * a switch that turns model answers off for the platform or one bank;
  * caps on output tokens, the history sent with each question and the
    question's length, which bound the cost of any single answer;
  * a short cache, so the same opening question about the same figures is
    answered once rather than paid for again.

Usage is recorded per person per day, in Lagos time, with tokens in and out.
Settings live in platform_settings (one row per key, a missing row means the
default below) and per-bank overrides in institution_assistant.
"""
from __future__ import annotations

import hashlib
import json
import threading
import time
from collections import defaultdict, deque
from datetime import datetime, timedelta, timezone

from fastapi import HTTPException

from core.db import cursor, row_to_dict

LAGOS = timezone(timedelta(hours=1))

# name: (default, minimum, maximum, what it means)
SETTINGS: dict[str, tuple[object, object, object, str]] = {
    "ai_enabled": (True, False, True, "Answer with an AI model. Off, every answer comes from the figures alone."),
    "per_person_per_minute": (6, 1, 60, "Questions one person may ask in a minute."),
    "per_person_per_day": (60, 1, 2000, "Questions one person may ask in a day."),
    "institution_daily_answers": (200, 0, 100000, "AI answers one institution gets a day. Past it, answers come from the figures alone."),
    "max_output_tokens": (350, 100, 1200, "Longest answer the model may write, in tokens."),
    "max_history_turns": (6, 0, 20, "Earlier messages sent with each question, for context."),
    "max_question_chars": (600, 100, 1000, "Longest question accepted."),
    "cache_minutes": (10, 0, 120, "How long a repeated opening question reuses its answer. 0 turns the cache off."),
}


def defaults() -> dict:
    return {k: v[0] for k, v in SETTINGS.items()}


def settings() -> dict:
    out = defaults()
    with cursor() as cur:
        cur.execute("SELECT key, value FROM platform_settings WHERE key LIKE 'assistant.%'")
        for r in cur.fetchall():
            key = r["key"].split(".", 1)[1]
            if key in SETTINGS:
                try:
                    out[key] = json.loads(r["value"])
                except ValueError:
                    pass
    return out


def update(changes: dict, by: str) -> dict:
    """Validate and save changed settings. Returns the full settings."""
    clean: dict = {}
    for key, value in changes.items():
        if key not in SETTINGS:
            raise HTTPException(status_code=400, detail=f"Unknown setting: {key}.")
        default, low, high, _ = SETTINGS[key]
        if isinstance(default, bool):
            if not isinstance(value, bool):
                raise HTTPException(status_code=400, detail=f"{key} must be true or false.")
        else:
            if isinstance(value, bool) or not isinstance(value, int):
                raise HTTPException(status_code=400, detail=f"{key} must be a whole number.")
            if not low <= value <= high:
                raise HTTPException(status_code=400, detail=f"{key} must be between {low} and {high}.")
        clean[key] = value
    with cursor() as cur:
        for key, value in clean.items():
            cur.execute(
                """INSERT INTO platform_settings (key, value, updated_by, updated_at) VALUES (?, ?, ?, datetime('now'))
                   ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_by = excluded.updated_by,
                                                  updated_at = excluded.updated_at""",
                (f"assistant.{key}", json.dumps(value), by),
            )
    return settings()


def bank_override(institution_id: str) -> dict:
    with cursor() as cur:
        cur.execute(
            "SELECT enabled, daily_answers, updated_by, updated_at FROM institution_assistant WHERE institution_id = ?",
            (institution_id,),
        )
        row = row_to_dict(cur.fetchone()) or {}
    enabled = row.get("enabled")
    return {
        "enabled": None if enabled is None else bool(enabled),
        "daily_answers": row.get("daily_answers"),
        "updated_by": row.get("updated_by"),
        "updated_at": row.get("updated_at"),
    }


def set_bank_override(institution_id: str, enabled: bool | None, daily_answers: int | None, by: str) -> dict:
    if daily_answers is not None and not 0 <= daily_answers <= 100000:
        raise HTTPException(status_code=400, detail="The daily AI answers must be between 0 and 100000.")
    with cursor() as cur:
        cur.execute(
            """INSERT INTO institution_assistant (institution_id, enabled, daily_answers, updated_by, updated_at)
               VALUES (?, ?, ?, ?, datetime('now'))
               ON CONFLICT(institution_id) DO UPDATE SET enabled = excluded.enabled,
                 daily_answers = excluded.daily_answers, updated_by = excluded.updated_by,
                 updated_at = excluded.updated_at""",
            (institution_id, None if enabled is None else int(enabled), daily_answers, by),
        )
    return bank_override(institution_id)


def today() -> str:
    return datetime.now(LAGOS).strftime("%Y-%m-%d")


# ── Limits ───────────────────────────────────────────────────────────────────

_minute: dict[str, deque] = defaultdict(deque)
_lock = threading.Lock()


def check_person(institution_id: str, email: str, cfg: dict) -> None:
    """The per-person limits. Over either one is a 429 with a plain reason."""
    key = f"{institution_id}:{email}"
    now = time.monotonic()
    with _lock:
        hits = _minute[key]
        while hits and now - hits[0] > 60:
            hits.popleft()
        if len(hits) >= cfg["per_person_per_minute"]:
            raise HTTPException(
                status_code=429,
                detail=f"That's a lot of questions at once. The limit is {cfg['per_person_per_minute']} a minute; "
                       "try again shortly.",
            )
        hits.append(now)
    with cursor() as cur:
        cur.execute(
            "SELECT questions FROM assistant_usage WHERE institution_id = ? AND email = ? AND day = ?",
            (institution_id, email, today()),
        )
        row = cur.fetchone()
    if row and row["questions"] >= cfg["per_person_per_day"]:
        raise HTTPException(
            status_code=429,
            detail=f"You've asked {cfg['per_person_per_day']} questions today, the daily limit. "
                   "It resets at midnight, Lagos time.",
        )


def model_allowance(institution_id: str, cfg: dict) -> tuple[bool, str | None]:
    """Whether this institution's next answer may use a model, and if not, why."""
    override = bank_override(institution_id)
    enabled = cfg["ai_enabled"] if override["enabled"] is None else override["enabled"]
    if not enabled:
        return False, "off"
    budget = cfg["institution_daily_answers"] if override["daily_answers"] is None else override["daily_answers"]
    with cursor() as cur:
        cur.execute(
            "SELECT COALESCE(SUM(model_answers), 0) AS n FROM assistant_usage WHERE institution_id = ? AND day = ?",
            (institution_id, today()),
        )
        used = cur.fetchone()["n"]
    if used >= budget:
        return False, "budget"
    return True, None


def record(institution_id: str, email: str, *, model: bool, cached: bool, input_tokens: int = 0,
           output_tokens: int = 0) -> None:
    with cursor() as cur:
        cur.execute(
            """INSERT INTO assistant_usage
                 (institution_id, email, day, questions, model_answers, cached_answers, input_tokens, output_tokens)
               VALUES (?, ?, ?, 1, ?, ?, ?, ?)
               ON CONFLICT(institution_id, email, day) DO UPDATE SET
                 questions = questions + 1,
                 model_answers = model_answers + excluded.model_answers,
                 cached_answers = cached_answers + excluded.cached_answers,
                 input_tokens = input_tokens + excluded.input_tokens,
                 output_tokens = output_tokens + excluded.output_tokens""",
            (institution_id, email, today(), int(model), int(cached), int(input_tokens), int(output_tokens)),
        )


# ── Cache ────────────────────────────────────────────────────────────────────
# In memory, which suits one process; it is a saving, never a source of truth.

_cache: dict[str, tuple[float, dict]] = {}
_CACHE_MAX = 500


def cache_key(institution_id: str, question: str, grounding: str) -> str:
    """Same bank, same question, same figures. Any new decision changes the figures."""
    norm = " ".join(question.lower().split())
    return hashlib.sha256(f"{institution_id}\0{norm}\0{grounding}".encode()).hexdigest()


def cache_get(key: str) -> dict | None:
    with _lock:
        hit = _cache.get(key)
        if hit and hit[0] > time.monotonic():
            return hit[1]
        _cache.pop(key, None)
    return None


def cache_put(key: str, value: dict, minutes: int) -> None:
    if minutes <= 0:
        return
    with _lock:
        if len(_cache) >= _CACHE_MAX:
            now = time.monotonic()
            for k in [k for k, (exp, _) in _cache.items() if exp <= now] or list(_cache)[: _CACHE_MAX // 5]:
                _cache.pop(k, None)
        _cache[key] = (time.monotonic() + minutes * 60, value)


def reset_runtime() -> None:
    """Forget in-memory rates and the cache (tests, and after a settings change)."""
    with _lock:
        _minute.clear()
        _cache.clear()


# ── Usage, for operators ─────────────────────────────────────────────────────

def usage(days: int = 30) -> dict:
    since = (datetime.now(LAGOS) - timedelta(days=days - 1)).strftime("%Y-%m-%d")
    with cursor() as cur:
        cur.execute(
            """SELECT day, SUM(questions) AS questions, SUM(model_answers) AS model_answers,
                      SUM(cached_answers) AS cached_answers, SUM(input_tokens) AS input_tokens,
                      SUM(output_tokens) AS output_tokens
               FROM assistant_usage WHERE day >= ? GROUP BY day ORDER BY day""",
            (since,),
        )
        by_day = [row_to_dict(r) for r in cur.fetchall()]
        cur.execute(
            """SELECT u.institution_id, i.name,
                      SUM(CASE WHEN u.day = ? THEN u.questions ELSE 0 END) AS questions_today,
                      SUM(CASE WHEN u.day = ? THEN u.model_answers ELSE 0 END) AS model_answers_today,
                      SUM(u.questions) AS questions, SUM(u.model_answers) AS model_answers,
                      SUM(u.input_tokens) AS input_tokens, SUM(u.output_tokens) AS output_tokens,
                      COUNT(DISTINCT u.email) AS people
               FROM assistant_usage u LEFT JOIN institutions i ON i.institution_id = u.institution_id
               WHERE u.day >= ? GROUP BY u.institution_id ORDER BY questions DESC""",
            (today(), today(), since),
        )
        by_institution = [row_to_dict(r) for r in cur.fetchall()]
    day = today()
    today_row = next((d for d in by_day if d["day"] == day), None) or {
        "questions": 0, "model_answers": 0, "cached_answers": 0, "input_tokens": 0, "output_tokens": 0}
    totals = {k: sum(int(d[k] or 0) for d in by_day)
              for k in ("questions", "model_answers", "cached_answers", "input_tokens", "output_tokens")}
    return {"days": days, "today": today_row, "totals": totals, "by_day": by_day, "by_institution": by_institution}


def institution_usage(institution_id: str, days: int = 30) -> dict:
    since = (datetime.now(LAGOS) - timedelta(days=days - 1)).strftime("%Y-%m-%d")
    with cursor() as cur:
        cur.execute(
            """SELECT COALESCE(SUM(CASE WHEN day = ? THEN model_answers END), 0) AS model_answers_today,
                      COALESCE(SUM(CASE WHEN day = ? THEN questions END), 0) AS questions_today,
                      COALESCE(SUM(questions), 0) AS questions, COALESCE(SUM(model_answers), 0) AS model_answers,
                      COALESCE(SUM(input_tokens), 0) AS input_tokens, COALESCE(SUM(output_tokens), 0) AS output_tokens
               FROM assistant_usage WHERE institution_id = ? AND day >= ?""",
            (today(), today(), institution_id, since),
        )
        return row_to_dict(cur.fetchone())
