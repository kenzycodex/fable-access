"""Signed dashboard sessions.

The console had no server-side session at all. `/auth/login` returned
`{"success": true, "institution_id": ...}` and nothing else, so there was
nothing for the API to validate and nothing for the frontend to present. The
frontend compensated by setting a cookie literally equal to `1`, and Next's
middleware checked only that it existed. Anyone could type
`document.cookie = "fable_auth=1"` and reach the console, and every API read
then took its tenant from a query parameter bound to no identity at all.

This module is the missing piece: a signed, expiring bearer token that names
the institution it was issued for.

Design notes
------------
Bearer token rather than a session cookie, because the console runs on Vercel
and the API on a different domain. A cross-site cookie needs
`SameSite=None; Secure` and brings CSRF exposure with it; an `Authorization`
header is same-origin-agnostic and carries no ambient authority, so there is
no CSRF surface to defend.

Stateless rather than a sessions table, because there is nothing here worth a
database round trip on every request. The tradeoff is honest: a token cannot
be revoked before it expires. Lifetimes are therefore short, and anything that
must revoke immediately (a password reset, say) needs a token-version column
before it can be relied on. That is not built, and this docstring is the note
saying so.

No JWT library. The payload is small and fixed, and hand-rolling
HMAC-SHA256-over-base64 avoids a dependency for something this narrow. The one
rule that matters is a constant-time signature comparison, which
`hmac.compare_digest` gives us.
"""
import base64
import hashlib
import hmac
import json
import logging
import secrets
import time

import config

logger = logging.getLogger("fable.sessions")

SESSION_TTL_SECONDS = 12 * 60 * 60  # a working day, then log in again


class SessionError(ValueError):
    """The token is missing, malformed, tampered with, or expired."""


def _secret() -> bytes:
    return config.SESSION_SECRET.encode()


def _b64e(raw: bytes) -> str:
    return base64.urlsafe_b64encode(raw).decode().rstrip("=")


def _b64d(text: str) -> bytes:
    return base64.urlsafe_b64decode(text + "=" * (-len(text) % 4))


def _sign(payload_b64: str) -> str:
    return _b64e(hmac.new(_secret(), payload_b64.encode(), hashlib.sha256).digest())


def issue(email: str, institution_id: str) -> dict:
    """Mint a token for a freshly authenticated admin."""
    now = int(time.time())
    payload = {
        "sub": email,
        "inst": institution_id,
        "iat": now,
        "exp": now + SESSION_TTL_SECONDS,
        # Distinguishes two tokens minted in the same second, and gives us a
        # handle to log without printing the token itself.
        "jti": secrets.token_hex(8),
    }
    payload_b64 = _b64e(json.dumps(payload, separators=(",", ":")).encode())
    return {
        "token": f"{payload_b64}.{_sign(payload_b64)}",
        "expires_at": payload["exp"],
        "expires_in": SESSION_TTL_SECONDS,
        "institution_id": institution_id,
    }


def verify(token: str | None) -> dict:
    """Return the payload of a valid token, or raise SessionError.

    Fails closed on every path: a missing token, a malformed one, a bad
    signature and an expired one all raise rather than returning a partial or
    default identity.
    """
    if not token:
        raise SessionError("No session token supplied.")

    parts = token.split(".")
    if len(parts) != 2:
        raise SessionError("Malformed session token.")

    payload_b64, signature = parts
    # Constant-time: a short-circuiting comparison leaks how much of a forged
    # signature was correct, which is enough to forge one byte at a time.
    if not hmac.compare_digest(_sign(payload_b64), signature):
        raise SessionError("Session signature does not verify.")

    try:
        payload = json.loads(_b64d(payload_b64))
    except (ValueError, TypeError) as exc:
        raise SessionError("Unreadable session payload.") from exc

    if not isinstance(payload, dict) or "inst" not in payload:
        raise SessionError("Session payload is missing its institution.")

    if int(payload.get("exp", 0)) <= int(time.time()):
        raise SessionError("Session expired. Sign in again.")

    return payload


def extract_token(request) -> str | None:
    """Pull the bearer token off a request.

    Accepts the `Authorization` header or an `X-Fable-Session` header. The
    cookie is deliberately *not* read here: the cookie exists so Next's
    middleware can route unauthenticated visitors, and treating it as an API
    credential would reintroduce the ambient authority this design avoids.
    """
    auth = request.headers.get("authorization", "")
    if auth.lower().startswith("bearer "):
        candidate = auth[7:].strip()
        # An institution API key is also presented as a bearer token. Session
        # tokens always carry the payload.signature shape, so the two are
        # distinguishable without guessing.
        if candidate.count(".") == 1:
            return candidate
    return request.headers.get("x-fable-session")
