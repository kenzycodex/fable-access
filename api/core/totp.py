"""Time-based one-time codes (RFC 6238), for operator sign-in.

Six digits, a new code every 30 seconds, HMAC-SHA1: the defaults every
authenticator app (Google Authenticator, Microsoft Authenticator, 1Password,
Authy) uses. The standard library is enough, so there is no dependency.
"""
from __future__ import annotations

import base64
import hashlib
import hmac
import secrets
import struct
import time
from urllib.parse import quote

DIGITS = 6
PERIOD = 30
# One step either side tolerates a phone clock that is up to 30 seconds off.
WINDOW = 1


def new_secret() -> str:
    """A random 160-bit secret, base32 as authenticator apps expect."""
    return base64.b32encode(secrets.token_bytes(20)).decode().rstrip("=")


def _key(secret: str) -> bytes:
    return base64.b32decode(secret + "=" * (-len(secret) % 8), casefold=True)


def code_at(secret: str, step: int) -> str:
    digest = hmac.new(_key(secret), struct.pack(">Q", step), hashlib.sha1).digest()
    offset = digest[-1] & 0x0F
    value = struct.unpack(">I", digest[offset:offset + 4])[0] & 0x7FFFFFFF
    return str(value % 10**DIGITS).zfill(DIGITS)


def current_step(now: float | None = None) -> int:
    return int((now if now is not None else time.time()) // PERIOD)


def verify(secret: str, code: str, last_step: int | None = None, now: float | None = None) -> int | None:
    """The time step the code belongs to, or None if it is wrong.

    A code is accepted only for a step later than `last_step`, so a code that
    was already used (or one from earlier) cannot be replayed.
    """
    code = "".join(ch for ch in str(code or "") if ch.isdigit())
    if len(code) != DIGITS:
        return None
    step = current_step(now)
    for candidate in range(step - WINDOW, step + WINDOW + 1):
        if last_step is not None and candidate <= last_step:
            continue
        if hmac.compare_digest(code_at(secret, candidate), code):
            return candidate
    return None


def provisioning_uri(secret: str, account: str, issuer: str = "Fable Operator") -> str:
    """The otpauth:// link an authenticator app reads from a QR code."""
    label = quote(f"{issuer}:{account}")
    return f"otpauth://totp/{label}?secret={secret}&issuer={quote(issuer)}&digits={DIGITS}&period={PERIOD}"
