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

Integration keys and platform settings are managed here (MANAGED), including
email (SMTP), SMS, Sentry, the frontend URL and CORS origins. Only what
protects the database itself stays environment-only: the session secret, the
master key (FABLE_SECRETS_KEY) and the PIN pepper. See docs/DEPLOYMENT.md.
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
    kind: str              # "secret", "model" or "config"
    probe: str | None      # which provider test checks it
    default: str = ""
    rotate_days: int = 90
    # Config only: how the value is read and the range an operator may set.
    value_type: str = "str"          # "int", "float" or "bool"
    minimum: float | None = None
    maximum: float | None = None
    choices: tuple = ()
    unit: str = ""
    help: str = ""
    config_attr: str | None = None   # the built-in default, read from core.config
    # Secrets only: whether the value may contain spaces (app passwords do).
    allow_spaces: bool = False
    # Read once at startup (CORS, Sentry): a change applies after a restart.
    restart: bool = False


MANAGED: dict[str, Spec] = {s.name: s for s in (
    Spec("OPENAI_API_KEY", "OpenAI API key", "AI providers", "secret", "openai"),
    Spec("OPENAI_MODEL", "OpenAI model", "AI providers", "model", None, "gpt-4o", 0),
    Spec("ANTHROPIC_API_KEY", "Anthropic API key", "AI providers", "secret", "anthropic"),
    Spec("ANTHROPIC_MODEL", "Anthropic model", "AI providers", "model", None, "claude-sonnet-5-5", 0),
    Spec("LOCATIONIQ_API_KEY", "LocationIQ key", "Address lookup", "secret", "locationiq"),
    Spec("GEOAPIFY_API_KEY", "Geoapify key", "Address lookup", "secret", "geoapify"),
    Spec("GOOGLE_MAPS_API_KEY", "Google Maps Geocoding key", "Address lookup", "secret", "google"),
    # Email: invites, password resets, customer alerts and one-time codes.
    Spec("SMTP_SERVER", "Mail server", "Email", "config", None, rotate_days=0, value_type="host",
         config_attr="SMTP_SERVER", help="The SMTP host, for example smtp.gmail.com."),
    Spec("SMTP_PORT", "Mail server port", "Email", "config", None, rotate_days=0, value_type="int",
         minimum=1, maximum=65535, config_attr="SMTP_PORT", help="Usually 587 (STARTTLS)."),
    Spec("SMTP_USERNAME", "Mail username", "Email", "config", None, rotate_days=0, value_type="str",
         config_attr="SMTP_USERNAME", help="The account Fable signs in to the mail server with."),
    Spec("SMTP_PASSWORD", "Mail password", "Email", "secret", None, allow_spaces=True,
         help="The mail account's password or app password."),
    Spec("SMTP_FROM", "Send as", "Email", "config", None, rotate_days=0, value_type="str",
         config_attr="SMTP_FROM", help='The From line, for example "Fable <no-reply@fable.ng>".'),
    # SMS: codes and short hold alerts, where a provider is configured.
    Spec("SMS_PROVIDER", "SMS provider", "SMS", "config", None, rotate_days=0, value_type="str",
         choices=("none", "termii"), config_attr="SMS_PROVIDER",
         help="none keeps SMS off: the product says so and never claims an SMS was sent."),
    Spec("TERMII_API_KEY", "Termii API key", "SMS", "secret", "termii"),
    Spec("SMS_SENDER_ID", "SMS sender ID", "SMS", "config", None, rotate_days=0, value_type="str",
         config_attr="SMS_SENDER_ID", help="The registered sender name customers see, up to 11 characters."),
    # Operations.
    Spec("SENTRY_DSN", "Sentry DSN", "Operations", "secret", None, restart=True,
         help="Error reporting. Applies after a restart."),
    Spec("FRONTEND_URL", "Frontend address", "Operations", "config", None, rotate_days=0, value_type="url",
         config_attr="FRONTEND_URL", help="Used for links in emails, for example https://fablehq.vercel.app."),
    Spec("FABLE_CORS_ORIGINS", "Allowed browser origins", "Operations", "config", None, rotate_days=0,
         value_type="origins", config_attr="CORS_ORIGINS_RAW", restart=True,
         help="Comma-separated frontend origins allowed to call the API. Applies after a restart."),
    # Platform settings: not secret, readable, changed through the same approval.
    Spec("TOPUP_MAX_AMOUNT", "Largest single sandbox top-up", "Sandbox money", "config", None, rotate_days=0,
         value_type="float", minimum=1_000, maximum=100_000_000, unit="₦", config_attr="TOPUP_MAX_AMOUNT",
         help="The most a test customer can add in one top-up."),
    Spec("TOPUP_DAILY_MAX", "Sandbox top-ups per day, in naira", "Sandbox money", "config", None, rotate_days=0,
         value_type="float", minimum=1_000, maximum=1_000_000_000, unit="₦", config_attr="TOPUP_DAILY_MAX",
         help="The most a test customer can add in a day."),
    Spec("TOPUP_DAILY_COUNT", "Sandbox top-ups per day", "Sandbox money", "config", None, rotate_days=0,
         value_type="int", minimum=1, maximum=100, unit="top-ups", config_attr="TOPUP_DAILY_COUNT",
         help="How many top-ups a test customer can make in a day."),
    Spec("FABLE_PIN_LENGTH", "PIN length", "Customer PIN", "config", None, rotate_days=0,
         value_type="int", choices=(4, 6), unit="digits", config_attr="PIN_LENGTH",
         help="For PINs set from now on. Existing PINs keep their length."),
    Spec("FABLE_PIN_MAX_ATTEMPTS", "Wrong PINs before a lock", "Customer PIN", "config", None, rotate_days=0,
         value_type="int", minimum=3, maximum=10, unit="attempts", config_attr="PIN_MAX_ATTEMPTS",
         help="Wrong entries before the PIN is locked."),
    Spec("FABLE_PIN_LOCKOUT_MINUTES", "PIN lock time", "Customer PIN", "config", None, rotate_days=0,
         value_type="int", minimum=5, maximum=1440, unit="minutes", config_attr="PIN_LOCKOUT_MINUTES",
         help="How long a locked PIN stays locked."),
    Spec("FABLE_PIN_BLOCK_WEAK", "Refuse weak PINs", "Customer PIN", "config", None, rotate_days=0,
         value_type="bool", config_attr="PIN_BLOCK_WEAK",
         help="Refuse repeated digits (0000) and plain sequences (1234)."),
    Spec("FABLE_CONTACT_SETTLE_HOURS", "New contact wait", "Customer PIN", "config", None, rotate_days=0,
         value_type="int", minimum=1, maximum=168, unit="hours", config_attr="CONTACT_SETTLE_HOURS",
         help="A code sent to an email added or changed within this time cannot release held money."),
    Spec("FABLE_SANDBOX_CONTACT_SETTLE_MINUTES", "New contact wait (sandbox)", "Customer PIN", "config", None,
         rotate_days=0, value_type="int", minimum=0, maximum=1440, unit="minutes",
         config_attr="SANDBOX_CONTACT_SETTLE_MINUTES",
         help="The same wait for sandbox banks, whose money is simulated."),
    Spec("GHOST_COOLING_HIGH", "Hold for high risk", "Ghost holds", "config", None, rotate_days=0,
         value_type="int", minimum=1, maximum=1440, unit="minutes", config_attr="GHOST_COOLING_HIGH",
         help="Default hold for risk 0.9 and above. Institutions can set their own."),
    Spec("GHOST_COOLING_MED", "Hold for medium risk", "Ghost holds", "config", None, rotate_days=0,
         value_type="int", minimum=1, maximum=1440, unit="minutes", config_attr="GHOST_COOLING_MED",
         help="Default hold for risk 0.7 to 0.9."),
    Spec("GHOST_COOLING_LOW", "Hold for low risk", "Ghost holds", "config", None, rotate_days=0,
         value_type="int", minimum=1, maximum=1440, unit="minutes", config_attr="GHOST_COOLING_LOW",
         help="Default hold below risk 0.7."),
    Spec("GHOST_LEGACY_MATCH_MINUTES", "Older clients: match window", "Ghost holds", "config", None, rotate_days=0,
         value_type="int", minimum=5, maximum=1440, unit="minutes", config_attr="GHOST_LEGACY_MATCH_MINUTES",
         help="A hold request without a transaction id is matched to the customer's block from this far back."),
    Spec("GHOST_RELEASE_REQUEST_HOURS", "Wait for the bank to verify", "Ghost holds", "config", None, rotate_days=0,
         value_type="int", minimum=1, maximum=168, unit="hours", config_attr="GHOST_RELEASE_REQUEST_HOURS",
         help="How long a hold stays once the customer asks their bank to release it."),
    Spec("BRANDING_SLUG_LOCK_DAYS", "Vanity link lock", "Branding", "config", None, rotate_days=0,
         value_type="int", minimum=0, maximum=90, unit="days", config_attr="BRANDING_SLUG_LOCK_DAYS",
         help="How long a changed vanity link stays locked."),
    Spec("BRANDING_MAX_LOGO_BYTES", "Largest logo", "Branding", "config", None, rotate_days=0,
         value_type="int", minimum=10_000, maximum=2_000_000, unit="bytes", config_attr="BRANDING_MAX_LOGO_BYTES",
         help="Logos are inlined into pages, so keep this small."),
    Spec("FABLE_RATE_LIMIT_MAX", "Requests per caller per window", "Operations", "config", None, rotate_days=0,
         value_type="int", minimum=30, maximum=2000, unit="requests", config_attr="RATE_LIMIT_MAX",
         help="Each caller's request limit before a 429."),
    Spec("FABLE_RATE_LIMIT_WINDOW", "Rate limit window", "Operations", "config", None, rotate_days=0,
         value_type="int", minimum=10, maximum=3600, unit="seconds", config_attr="RATE_LIMIT_WINDOW",
         help="The window the request limit is counted over."),
    Spec("FABLE_EXPLAINER_TIMEOUT", "Explanation time limit", "Operations", "config", None, rotate_days=0,
         value_type="int", minimum=2, maximum=30, unit="seconds", config_attr="EXPLAINER_TIMEOUT_SECONDS",
         help="The longest an AI write-up may take. It never delays a decision."),
    # Scoring detection: these decide whether a signal fires, so no backtest can
    # replay them. Approval, audit and rollback apply; the effect is not previewed.
    Spec("FABLE_VELOCITY_WINDOW_MIN", "Burst window", "Scoring detection", "config", None, rotate_days=0,
         value_type="int", minimum=1, maximum=120, unit="minutes", config_attr="VELOCITY_WINDOW_MINUTES",
         help="Transfers inside this window count towards a burst. Not backtested."),
    Spec("FABLE_VELOCITY_FLAG", "Transfers for a burst", "Scoring detection", "config", None, rotate_days=0,
         value_type="int", minimum=2, maximum=20, unit="transfers", config_attr="VELOCITY_FLAG_COUNT",
         help="This many in the window adds the burst signal. Not backtested."),
    Spec("FABLE_VELOCITY_HIGH", "Transfers for a heavy burst", "Scoring detection", "config", None, rotate_days=0,
         value_type="int", minimum=3, maximum=50, unit="transfers", config_attr="VELOCITY_HIGH_COUNT",
         help="This many adds the heavy-burst signal. Always above the burst count. Not backtested."),
    Spec("FABLE_TENURE_DISCOUNT_MAX", "Most credit for clean history", "Scoring detection", "config", None,
         rotate_days=0, value_type="float", minimum=0, maximum=0.10, unit="points", config_attr="TENURE_DISCOUNT_MAX",
         help="The most a long, clean record takes off a score. Never more than 0.10. Not backtested."),
    Spec("FABLE_TENURE_FULL_AT", "Clean transfers for full credit", "Scoring detection", "config", None, rotate_days=0,
         value_type="int", minimum=20, maximum=1000, unit="transfers", config_attr="TENURE_FULL_AT",
         help="How many clean transfers earn the full credit. Not backtested."),
    Spec("FABLE_RECIPIENT_MEMORY_DAYS", "How long a recipient stays known", "Scoring detection", "config", None,
         rotate_days=0, value_type="int", minimum=30, maximum=1095, unit="days", config_attr="RECIPIENT_MEMORY_DAYS",
         help="After this long without a payment, a recipient counts as new again. Not backtested."),
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


def _decode_key(raw: str) -> bytes | None:
    try:
        key = base64.urlsafe_b64decode(raw + "=" * (-len(raw) % 4))
    except ValueError:
        return None
    return key if len(key) == 32 else None


def keyring() -> dict[str, bytes]:
    """Every master key this server holds, by key id: the current one and any
    previous ones still listed for a rotation."""
    keys: dict[str, bytes] = {}
    for item in (config.SECRETS_KEY_PREVIOUS or "").split(","):
        kid, _, raw = item.strip().partition(":")
        key = _decode_key(raw.strip()) if kid and raw else None
        if key:
            keys[kid.strip()] = key
    current = master_key()
    if current:
        keys[config.SECRETS_KEY_ID] = current
    return keys


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

    # The key named by the record's key id first, so a rotation in progress
    # (values under the previous key) keeps working; then any other key held.
    if key:
        candidates = [key]
    else:
        ring = keyring()
        first = ring.get(row.get("kid") or "")
        candidates = ([first] if first else []) + [k for k in ring.values() if k is not first]
    if not candidates or not row.get("ciphertext") or not row.get("wrapped_key"):
        raise SecretsError("This key cannot be opened.")
    aad = _aad(name, version, purpose)
    wrapped = bytes(row["wrapped_key"])
    for kek in candidates:
        try:
            dek = AESGCM(kek).decrypt(wrapped[:12], wrapped[12:], aad)
            return AESGCM(dek).decrypt(bytes(row["nonce"]), bytes(row["ciphertext"]), aad).decode()
        except (InvalidTag, ValueError):
            continue
    raise SecretsError("This key does not decrypt: wrong master key, or the record was tampered with.")


def fingerprint(value: str) -> str:
    return hashlib.sha256(value.encode()).hexdigest()[:12]


def last4(value: str, kind: str = "secret") -> str:
    return value if kind in ("model", "config") else ("…" + value[-4:] if len(value) >= 8 else "…")


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
    secret = spec is None or spec.kind == "secret"
    env = env_value(name)
    if env:
        if secret:
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
        if secret:
            remember(value)
        return value
    return spec.default if spec else ""


def display_number(x: float) -> str:
    """A setting's value for people: 500,000 and 0.08, never 0.08 shown as 0."""
    return f"{x:,.0f}" if float(x) == int(x) else f"{x:,g}"


def parse_setting(spec: Spec, raw) -> object:
    """A config value in its type. Raises ValueError when it is not valid."""
    text = str(raw).strip()
    if spec.value_type in ("str", "host", "url", "origins"):
        return _parse_text(spec, text)
    if spec.value_type == "bool":
        lowered = text.lower()
        if lowered in ("1", "true", "yes", "on"):
            return True
        if lowered in ("0", "false", "no", "off"):
            return False
        raise ValueError("Use true or false.")
    number = float(text.replace(",", ""))
    value = int(number) if spec.value_type == "int" else number
    if spec.value_type == "int" and number != int(number):
        raise ValueError("Use a whole number.")
    if spec.choices and value not in spec.choices:
        raise ValueError(f"Choose {' or '.join(str(c) for c in spec.choices)}.")
    if spec.minimum is not None and value < spec.minimum:
        raise ValueError(f"The lowest allowed is {display_number(spec.minimum)}.")
    if spec.maximum is not None and value > spec.maximum:
        raise ValueError(f"The highest allowed is {display_number(spec.maximum)}.")
    return value


_HOST_RE = re.compile(r"^[A-Za-z0-9.-]{1,253}$")


def _parse_text(spec: Spec, text: str) -> str:
    """Text settings: trimmed, bounded, and checked by kind."""
    if len(text) > 500:
        raise ValueError("That is too long.")
    if spec.choices and text not in spec.choices:
        raise ValueError(f"Choose {' or '.join(str(c) for c in spec.choices)}.")
    if spec.value_type == "host" and not _HOST_RE.match(text):
        raise ValueError("Enter a host name, for example smtp.gmail.com.")
    if spec.value_type == "url" and not re.match(r"^https?://[^\s/]+", text):
        raise ValueError("Enter a full address starting with https://.")
    if spec.value_type == "origins":
        if text != "*":
            for origin in (o.strip() for o in text.split(",")):
                if not re.match(r"^https?://[^\s/,]+$", origin):
                    raise ValueError("Enter origins like https://fablehq.vercel.app, separated by commas, with no path.")
    if spec.name == "SMS_SENDER_ID" and not 1 <= len(text) <= 11:
        raise ValueError("A sender ID is 1 to 11 characters.")
    return text


def setting(name: str):
    """A platform setting in force: the server environment, else the value
    approved in the console, else the built-in default."""
    spec = MANAGED[name]
    raw = get(name)
    if raw:
        try:
            return parse_setting(spec, raw)
        except ValueError:
            pass  # an invalid value never takes effect; the default stands
    return getattr(config, spec.config_attr) if spec.config_attr else None


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
