"""Integration keys: where the code reads them, and how they are kept.

Read every managed key through get(). It applies one rule of precedence:

  1. The server environment wins. A variable set in api/.env is used as is,
     and the operator console shows it as managed there, read-only.
  2. Otherwise, the active version stored from the operator console.
  3. Otherwise, the built-in default (model names) or nothing.

Stored values are envelope-encrypted. Each value has its own random 256-bit
data key and is sealed with AES-256-GCM; the data key is sealed the same way
with the master key (FABLE_SECRETS_KEY), which exists only in the server
environment. The secret's name, version and purpose are bound in as
additional authenticated data, so a ciphertext copied into another row or
version fails to open. Each row records the master key id, so the master key
can be rotated by re-wrapping (scripts/rewrap_secrets.py) without anyone
re-entering a value.

Only a short list of integration keys is managed here (MANAGED). Session
secrets, the master key, the PIN pepper, email (SMTP) settings and anything
that changes a security boundary stay in the environment: see docs/SECRETS.md.
"""
from __future__ import annotations

import base64
import hashlib
import os
import re
import threading
import time
from dataclasses import dataclass

from core import config

CACHE_SECONDS = 30


@dataclass(frozen=True)
class Spec:
    name: str
    label: str
    group: str
    kind: str              # "secret" or "model"
    probe: str | None      # which provider test checks it
    default: str = ""
    rotate_days: int = 90


MANAGED: dict[str, Spec] = {s.name: s for s in (
    Spec("OPENAI_API_KEY", "OpenAI API key", "AI providers", "secret", "openai"),
    Spec("OPENAI_MODEL", "OpenAI model", "AI providers", "model", None, "gpt-4o", 0),
    Spec("ANTHROPIC_API_KEY", "Anthropic API key", "AI providers", "secret", "anthropic"),
    Spec("ANTHROPIC_MODEL", "Anthropic model", "AI providers", "model", None, "claude-sonnet-5-5", 0),
    Spec("LOCATIONIQ_API_KEY", "LocationIQ key", "Address lookup", "secret", "locationiq"),
    Spec("GEOAPIFY_API_KEY", "Geoapify key", "Address lookup", "secret", "geoapify"),
    Spec("GOOGLE_MAPS_API_KEY", "Google Maps Geocoding key", "Address lookup", "secret", "google"),
)}

# Model names an operator may choose. Extend with FABLE_MODEL_ALLOWLIST.
MODEL_ALLOWLIST: dict[str, set[str]] = {
    "OPENAI_MODEL": {"gpt-4o", "gpt-4o-mini", "gpt-4.1", "gpt-4.1-mini"},
    "ANTHROPIC_MODEL": {"claude-opus-5-5", "claude-sonnet-5-5", "claude-haiku-5-5"},
}


def allowed_models(name: str) -> list[str]:
    return sorted(MODEL_ALLOWLIST.get(name, set()) | {m for m in config.EXTRA_MODELS})


class SecretsError(RuntimeError):
    pass


# ── Encryption ───────────────────────────────────────────────────────────────

def master_key() -> bytes | None:
    raw = config.SECRETS_KEY
    if not raw:
        return None
    try:
        key = base64.urlsafe_b64decode(raw + "=" * (-len(raw) % 4))
    except ValueError:
        return None
    return key if len(key) == 32 else None


def _aad(name: str, version: int | str, purpose: str) -> bytes:
    return f"fable-secret|{name}|{version}|{purpose}".encode()


def seal(value: str, name: str, version: int | str, purpose: str = "active", key: bytes | None = None,
         kid: str | None = None) -> dict:
    """Envelope-encrypt one value. Returns the columns to store."""
    from cryptography.hazmat.primitives.ciphers.aead import AESGCM

    kek = key or master_key()
    if not kek:
        raise SecretsError("FABLE_SECRETS_KEY is not set, so keys cannot be stored from the console.")
    aad = _aad(name, version, purpose)
    dek = AESGCM.generate_key(bit_length=256)
    nonce = os.urandom(12)
    ciphertext = AESGCM(dek).encrypt(nonce, value.encode(), aad)
    wrap_nonce = os.urandom(12)
    wrapped = wrap_nonce + AESGCM(kek).encrypt(wrap_nonce, dek, aad)
    return {"ciphertext": ciphertext, "nonce": nonce, "wrapped_key": wrapped, "kid": kid or config.SECRETS_KEY_ID}


def open_sealed(row: dict, name: str, version: int | str, purpose: str = "active", key: bytes | None = None) -> str:
    """Decrypt a stored value. Raises SecretsError if anything does not match."""
    from cryptography.exceptions import InvalidTag
    from cryptography.hazmat.primitives.ciphers.aead import AESGCM

    kek = key or master_key()
    if not kek or not row.get("ciphertext") or not row.get("wrapped_key"):
        raise SecretsError("This key cannot be opened.")
    aad = _aad(name, version, purpose)
    try:
        wrapped = bytes(row["wrapped_key"])
        dek = AESGCM(kek).decrypt(wrapped[:12], wrapped[12:], aad)
        return AESGCM(dek).decrypt(bytes(row["nonce"]), bytes(row["ciphertext"]), aad).decode()
    except (InvalidTag, ValueError) as exc:
        raise SecretsError("This key does not decrypt: wrong master key, or the record was tampered with.") from exc


def fingerprint(value: str) -> str:
    return hashlib.sha256(value.encode()).hexdigest()[:12]


def last4(value: str, kind: str = "secret") -> str:
    return value if kind == "model" else ("…" + value[-4:] if len(value) >= 8 else "…")


# ── Reading ──────────────────────────────────────────────────────────────────

_lock = threading.Lock()
_cache: dict[str, tuple[str | None, float]] = {}
_generation = {"value": None, "checked": 0.0}
# Every value loaded, so logs and error reports can scrub them.
_loaded: set[str] = set()


def env_value(name: str) -> str:
    return (os.getenv(name) or "").strip()


def _current_generation() -> str | None:
    from core.db import cursor

    with cursor() as cur:
        cur.execute("SELECT value FROM platform_settings WHERE key = 'secrets.generation'")
        row = cur.fetchone()
    return row["value"] if row else None


def bump_generation() -> None:
    """Tell every process that a stored key changed (checked within 30 s)."""
    from core.db import cursor

    with cursor() as cur:
        cur.execute(
            """INSERT INTO platform_settings (key, value, updated_by) VALUES ('secrets.generation', ?, 'system')
               ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')""",
            (str(time.time_ns()),),
        )
    with _lock:
        _cache.clear()
        _generation["checked"] = 0.0


def _refresh_if_changed() -> None:
    now = time.monotonic()
    if now - _generation["checked"] < CACHE_SECONDS:
        return
    try:
        gen = _current_generation()
    except Exception:  # noqa: BLE001 - a database blip keeps the cached values
        return
    with _lock:
        _generation["checked"] = now
        if gen != _generation["value"]:
            _generation["value"] = gen
            _cache.clear()


def _stored(name: str) -> str | None:
    from core.db import cursor

    with cursor() as cur:
        cur.execute(
            "SELECT * FROM platform_secrets WHERE name = ? AND status = 'active' ORDER BY version DESC LIMIT 1",
            (name,),
        )
        row = cur.fetchone()
    if not row:
        return None
    try:
        return open_sealed(dict(row), name, row["version"])
    except SecretsError:
        import logging

        logging.getLogger("fable.secrets").error("The stored %s cannot be decrypted; check FABLE_SECRETS_KEY.", name)
        return None


def get(name: str) -> str:
    """The value in force for a managed key, or "" when there is none."""
    spec = MANAGED.get(name)
    env = env_value(name)
    if env:
        remember(env)
        return env
    _refresh_if_changed()
    with _lock:
        hit = _cache.get(name)
    if hit is None:
        try:
            value = _stored(name)
        except Exception:  # noqa: BLE001 - no table yet, or the database is busy
            value = None
        with _lock:
            _cache[name] = (value, time.monotonic())
    else:
        value = hit[0]
    if value:
        remember(value)
        return value
    return spec.default if spec else ""


def source(name: str) -> str:
    """"environment", "console" or "unset"."""
    if env_value(name):
        return "environment"
    from core.db import cursor

    with cursor() as cur:
        cur.execute("SELECT 1 FROM platform_secrets WHERE name = ? AND status = 'active' LIMIT 1", (name,))
        return "console" if cur.fetchone() else "unset"


def version_key(*names: str) -> str:
    """Changes whenever any of these keys' values change, for rebuilding clients."""
    return hashlib.sha256("\0".join(get(n) for n in names).encode()).hexdigest()


# ── Keeping values out of logs ───────────────────────────────────────────────

_KEY_SHAPES = re.compile(r"(sk-ant-[A-Za-z0-9_\-]{8,}|sk-(?:proj-)?[A-Za-z0-9_\-]{16,}|AIza[0-9A-Za-z_\-]{20,}|pk\.[0-9a-f]{24,})")


def remember(value: str) -> None:
    if value and len(value) >= 8:
        _loaded.add(value)


def scrub(text: str) -> str:
    """Remove any loaded key, and anything shaped like a provider key."""
    if not text:
        return text
    for value in list(_loaded):
        if value in text:
            text = text.replace(value, "[secret]")
    return _KEY_SHAPES.sub("[secret]", text)


class ScrubFilter:
    """A logging filter that removes secrets from every record."""

    def filter(self, record) -> bool:  # noqa: A003 - logging's interface
        try:
            message = record.getMessage()
        except Exception:  # noqa: BLE001
            return True
        cleaned = scrub(message)
        if cleaned != message:
            record.msg, record.args = cleaned, ()
        return True


def scrub_event(event: dict, _hint=None) -> dict:
    """Sentry before_send: the same scrub over the whole event."""
    import json

    try:
        return json.loads(scrub(json.dumps(event, default=str)))
    except Exception:  # noqa: BLE001 - never lose an error report over scrubbing
        return event
