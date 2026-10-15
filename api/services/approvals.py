"""Maker-checker for platform changes, shared by Environment and Engine.

* A change waits for a *different* platform owner to approve it, within
  APPROVAL_HOURS, then it expires.
* With only one owner (who can step up), it is held for COOLING_HOURS instead,
  every owner is emailed straight away, and it can be cancelled until then.

Who may act, and the step-up each action needs, stay with the caller (the
routers check the role and core/operator_stepup.verify the factor).
"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone

from fastapi import HTTPException

from core.db import cursor

APPROVAL_HOURS = 24
COOLING_HOURS = 12


def now() -> datetime:
    return datetime.now(timezone.utc)


def iso(dt: datetime) -> str:
    return dt.strftime("%Y-%m-%d %H:%M:%S")


def owners() -> list[str]:
    """Platform owners who can step up, and so can approve."""
    with cursor() as cur:
        cur.execute("SELECT email FROM operators WHERE role = 'platform_owner' AND active = 1 AND totp_enabled = 1")
        return [r["email"] for r in cur.fetchall()]


def plan() -> dict:
    """How a new proposal waits: for a second owner, or a cooling-off period."""
    single = len(owners()) < 2
    at = now()
    return {
        "single": single,
        "status": "cooling" if single else "pending",
        "apply_after": iso(at + timedelta(hours=COOLING_HOURS)) if single else None,
        "expires_at": None if single else iso(at + timedelta(hours=APPROVAL_HOURS)),
    }


def ensure_checker(proposed_by: str, approver: str) -> None:
    if proposed_by == approver:
        raise HTTPException(status_code=403, detail="Another owner has to approve a change you proposed.")
