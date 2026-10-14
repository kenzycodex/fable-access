"""Fable's own staff: the operators who provision and look after institutions.

Operators are a separate population from any bank's console members. They have
their own table, their own sign-in, and their own session tokens, signed with a
key derived for this purpose only, so a bank's console token can never act as
an operator token and the reverse.

Every operator signs in with a password and a time-based code from an
authenticator app (MFA is mandatory for privileged access, per the CBN's
risk-based cybersecurity framework). The authenticator secret is stored
encrypted. Codes cannot be replayed.

Roles:
  platform_owner  everything, including managing operators
  platform_admin  provisions, suspends and reactivates institutions
  support         reads everything, changes nothing
"""
from __future__ import annotations

import base64
import hashlib
import hmac
import json
import secrets
import time

from fastapi import HTTPException, Request

from core import config
from core.db import cursor, row_to_dict

ROLES = ("platform_owner", "platform_admin", "support")
_RANK = {"support": 0, "platform_admin": 1, "platform_owner": 2}

ACTIVE, REMOVED, INVITED = 1, 0, 2
SESSION_TTL_SECONDS = 8 * 60 * 60
CHALLENGE_TTL_SECONDS = 5 * 60
INVITE_TTL_SECONDS = 3 * 24 * 60 * 60

HEADER = "x-fable-operator"


class OperatorError(ValueError):
    """An operator credential that is missing, invalid or expired."""


# ── Keys ─────────────────────────────────────────────────────────────────────

def _derived(purpose: str) -> bytes:
    """A key for one purpose, derived from the server's session secret."""
    return hmac.new(config.SESSION_SECRET.encode(), f"fable:{purpose}:v1".encode(), hashlib.sha256).digest()


def _fernet():
    from cryptography.fernet import Fernet

    return Fernet(base64.urlsafe_b64encode(_derived("operator-totp")))


def seal(secret: str) -> str:
    return _fernet().encrypt(secret.encode()).decode()


def unseal(sealed: str) -> str:
    return _fernet().decrypt(sealed.encode()).decode()


# ── Tokens ───────────────────────────────────────────────────────────────────

def _b64e(raw: bytes) -> str:
    return base64.urlsafe_b64encode(raw).decode().rstrip("=")


def _b64d(text: str) -> bytes:
    return base64.urlsafe_b64decode(text + "=" * (-len(text) % 4))


def _sign(body: str) -> str:
    return _b64e(hmac.new(_derived("operator-session"), body.encode(), hashlib.sha256).digest())


def _mint(payload: dict, ttl: int) -> tuple[str, int]:
    now = int(time.time())
    payload = {**payload, "iat": now, "exp": now + ttl, "jti": secrets.token_hex(8)}
    body = _b64e(json.dumps(payload, separators=(",", ":")).encode())
    return f"op.{body}.{_sign(body)}", payload["exp"]


def _read(token: str | None, audience: str) -> dict:
    if not token or not token.startswith("op.") or token.count(".") != 2:
        raise OperatorError("Sign in as a Fable operator.")
    _, body, signature = token.split(".")
    if not hmac.compare_digest(_sign(body), signature):
        raise OperatorError("Operator session does not verify.")
    try:
        payload = json.loads(_b64d(body))
    except (ValueError, TypeError) as exc:
        raise OperatorError("Unreadable operator session.") from exc
    if payload.get("aud") != audience:
        raise OperatorError("Wrong kind of operator token.")
    if int(payload.get("exp", 0)) <= int(time.time()):
        raise OperatorError("Operator session expired. Sign in again.")
    return payload


def issue_session(email: str, version: int) -> dict:
    token, expires = _mint({"sub": email, "aud": "operator", "sv": int(version or 0)}, SESSION_TTL_SECONDS)
    return {"token": token, "expires_at": expires}


def issue_challenge(email: str, enroll: bool) -> str:
    """Proof that the password was right, valid for five minutes, which the
    authenticator code then turns into a session."""
    token, _ = _mint({"sub": email, "aud": "operator-mfa", "enroll": enroll}, CHALLENGE_TTL_SECONDS)
    return token


def read_challenge(token: str) -> dict:
    return _read(token, "operator-mfa")


# ── Accounts ─────────────────────────────────────────────────────────────────

def get(email: str) -> dict | None:
    with cursor() as cur:
        cur.execute("SELECT * FROM operators WHERE email = ?", ((email or "").strip().lower(),))
        return row_to_dict(cur.fetchone())


def public(op: dict) -> dict:
    return {
        "email": op["email"],
        "name": op.get("name"),
        "role": op.get("role"),
        "status": {ACTIVE: "active", INVITED: "invited", REMOVED: "removed"}.get(op.get("active"), "active"),
        "mfa": bool(op.get("totp_enabled")),
        "created_at": op.get("created_at"),
        "last_login_at": op.get("last_login_at"),
    }


def current(request: Request) -> dict:
    """The signed-in operator, re-read from the database on every call, so a
    removed operator or a changed password ends their session at once."""
    try:
        payload = _read(request.headers.get(HEADER), "operator")
    except OperatorError as exc:
        raise HTTPException(status_code=401, detail=str(exc)) from exc
    op = get(payload["sub"])
    if not op or op.get("active") != ACTIVE or not op.get("totp_enabled"):
        raise HTTPException(status_code=401, detail="This operator account no longer has access.")
    if int(payload.get("sv", 0)) != int(op.get("session_version") or 0):
        raise HTTPException(status_code=401, detail="Your session ended. Sign in again.")
    return op


def require(request: Request, minimum: str) -> dict:
    op = current(request)
    if _RANK.get(op.get("role"), -1) < _RANK[minimum]:
        raise HTTPException(status_code=403, detail="Your operator role cannot do this.")
    return op


def record(event: str, actor: str, institution_id: str | None = None, **details) -> None:
    """Every operator action goes in the audit log, under the institution it
    touched, so the bank can see it too."""
    from services import audit

    audit.record(event, None, institution_id=institution_id, operator=actor, **details)
