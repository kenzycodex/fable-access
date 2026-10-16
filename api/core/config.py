import os

from dotenv import load_dotenv

load_dotenv()

# --- AI providers for Shield's plain-language explanations ---
# Fable tries Anthropic Claude first, then OpenAI GPT-4o, then a deterministic
# local template. Set at least one key for real AI explanations; with neither
# set the API still returns full risk scores and signals (it never fails the
# request over a missing explainer dependency).
ANTHROPIC_API_KEY = os.getenv("ANTHROPIC_API_KEY", "")
ANTHROPIC_MODEL = os.getenv("ANTHROPIC_MODEL", "claude-sonnet-5-5")
OPENAI_API_KEY = os.getenv("OPENAI_API_KEY", "")
OPENAI_MODEL = os.getenv("OPENAI_MODEL", "gpt-4o")

ENVIRONMENT = os.getenv("ENVIRONMENT", "development")
# Treat an unset OR empty FABLE_DB_PATH the same: fall back to a real file next
# to this module. An empty value would make SQLite use a throwaway per-connection
# temp DB (nothing persists across requests/restarts), so we guard against it.
DB_PATH = (os.getenv("FABLE_DB_PATH") or "").strip() or os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "fable.db")

# --- Dashboard & Onboarding ---
FRONTEND_URL = os.getenv("FRONTEND_URL", "http://localhost:3000")
SMTP_SERVER = os.getenv("SMTP_SERVER", "smtp.gmail.com")
SMTP_PORT = int(os.getenv("SMTP_PORT", "587"))
SMTP_USERNAME = os.getenv("SMTP_USERNAME", "")
SMTP_PASSWORD = os.getenv("SMTP_PASSWORD", "")
SMTP_FROM = os.getenv("SMTP_FROM", "Fable Provisioning <no-reply@fable.ng>")
# These, and the SMS settings below, can also be set from the operator console
# (core/secrets.MANAGED). The environment still wins; code should read them
# through core/integrations.py, not these constants, so a console change applies.

# --- SMS (codes and short alerts) ---
# "none" or a provider in services/sms.py. With none, SMS is unavailable and
# the product says so; nothing ever claims an SMS was sent.
SMS_PROVIDER = os.getenv("SMS_PROVIDER", "none").strip().lower() or "none"
SMS_SENDER_ID = os.getenv("SMS_SENDER_ID", "Fable")
TERMII_BASE_URL = os.getenv("TERMII_BASE_URL", "https://api.ng.termii.com")

# --- Security / ops (all optional; safe demo defaults) ---
# Comma-separated API keys. If set, protected endpoints require
# `Authorization: Bearer <key>` or `X-API-Key: <key>`. If empty, auth is off
# (demo mode) so evaluators can call the API with no setup.
_raw_keys = os.getenv("FABLE_API_KEYS", "")
API_KEYS = {k.strip() for k in _raw_keys.split(",") if k.strip()}

# Per-client rate limit (requests / window seconds). Generous by default so it
# never trips during a demo, but present so a burst can't crash the service.
RATE_LIMIT_MAX = int(os.getenv("FABLE_RATE_LIMIT_MAX", "180"))
RATE_LIMIT_WINDOW = int(os.getenv("FABLE_RATE_LIMIT_WINDOW", "60"))

# CORS allowed origins. "*" for the demo; set a comma-separated list in prod.
_raw_origins = os.getenv("FABLE_CORS_ORIGINS", "*")
CORS_ORIGINS_RAW = _raw_origins.strip() or "*"
CORS_ORIGINS = ["*"] if _raw_origins.strip() == "*" else [o.strip() for o in _raw_origins.split(",") if o.strip()]

# Optional Sentry error monitoring.
SENTRY_DSN = os.getenv("SENTRY_DSN", "")

# --- Dashboard sessions ---
# Signs the console's session tokens. Must be set in production: without it a
# random secret is generated per process, so every restart silently invalidates
# every session, and two processes would reject each other's tokens.
# Generate with: python -c "import secrets; print(secrets.token_urlsafe(48))"
SESSION_SECRET = os.getenv("FABLE_SESSION_SECRET", "").strip()
if not SESSION_SECRET:
    import secrets as _secrets
    SESSION_SECRET = _secrets.token_urlsafe(48)
    _SESSION_SECRET_IS_EPHEMERAL = True
else:
    _SESSION_SECRET_IS_EPHEMERAL = False

# Return the OTP in the API response when delivery fails. Development only.
# This exists so the step-up flow stays testable with no SMS/SMTP provider
# wired; it must never be enabled anywhere real, because the whole point of an
# out-of-band code is that it does NOT travel back down the channel that asked
# for it. Gated on an explicit opt-in AND a non-production environment, so a
# stray env var alone cannot switch it on in prod.
ALLOW_DEBUG_OTP = (
    os.getenv("FABLE_ALLOW_DEBUG_OTP", "").strip().lower() in ("1", "true", "yes")
    and ENVIRONMENT != "production"
)

# --- Integration keys managed from the operator console (core/secrets.py) ---
# The master key that wraps every stored key: 32 random bytes, urlsafe base64.
# It lives only here, never in the database. Without it the console can show
# what is configured but cannot store or read any key. Losing it makes stored
# keys unreadable (re-enter them, or put them back in .env). Back it up offline.
# python -c "import secrets,base64;print(base64.urlsafe_b64encode(secrets.token_bytes(32)).decode())"
SECRETS_KEY = os.getenv("FABLE_SECRETS_KEY", "").strip()
SECRETS_KEY_ID = os.getenv("FABLE_SECRETS_KEY_ID", "k1").strip() or "k1"
# Break-glass: "off" makes the console read-only for keys.
SECRETS_WRITE = os.getenv("FABLE_SECRETS_WRITE", "on").strip().lower() not in ("off", "0", "false", "no")
# Model names an operator may choose, beyond the built-in allowlist.
EXTRA_MODELS = {m.strip() for m in os.getenv("FABLE_MODEL_ALLOWLIST", "").split(",") if m.strip()}

# --- Customer PIN and verification rules ---
# Every number here is an operator choice, not something the code decides on
# its own. The values below are the defaults; set the variable to change one.


def _env_int(name: str, default: int, minimum: int = 1) -> int:
    """An integer from the environment. A missing, blank or invalid value falls
    back to the default rather than stopping the service from starting."""
    try:
        return max(int(os.getenv(name, "").strip() or default), minimum)
    except ValueError:
        return default


def _env_flag(name: str, default: bool = False) -> bool:
    raw = os.getenv(name, "").strip().lower()
    if not raw:
        return default
    return raw in ("1", "true", "yes", "on")


# How many digits a transaction PIN has. 4 is what most banking apps use; 6 is
# the stricter choice. Only 4 and 6 are accepted.
PIN_LENGTH = 6 if _env_int("FABLE_PIN_LENGTH", 4) == 6 else 4
# Wrong PIN attempts before the PIN is locked, and for how long.
PIN_MAX_ATTEMPTS = _env_int("FABLE_PIN_MAX_ATTEMPTS", 5)
PIN_LOCKOUT_MINUTES = _env_int("FABLE_PIN_LOCKOUT_MINUTES", 15)
# Off by default: the customer chooses any PIN. Turn on to refuse repeated
# digits (0000) and plain sequences (1234, 4321).
PIN_BLOCK_WEAK = _env_flag("FABLE_PIN_BLOCK_WEAK", False)

# A server-held key mixed into every PIN hash (a "pepper"). A 4–6 digit PIN can
# be guessed offline from a stolen database in moments, whatever the hash; with
# a pepper that never touches the database, the stolen hashes are useless on
# their own. Versioned like any key: each hash records the pepper id it used,
# so the pepper can be rotated by setting the old one as PREVIOUS ("id:value")
# while PINs re-hash on their next correct entry. Losing the pepper locks every
# PIN, the same as losing the secrets master key; back it up offline.
PIN_PEPPER = os.getenv("FABLE_PIN_PEPPER", "").strip()
PIN_PEPPER_ID = (os.getenv("FABLE_PIN_PEPPER_ID", "1").strip() or "1") if PIN_PEPPER else "0"
_prev_pepper = os.getenv("FABLE_PIN_PEPPER_PREVIOUS", "").strip()
PIN_PEPPERS: dict[str, str] = {"0": ""}
if ":" in _prev_pepper:
    _pid, _pval = _prev_pepper.split(":", 1)
    if _pid.strip() and _pval.strip():
        PIN_PEPPERS[_pid.strip()] = _pval.strip()
if PIN_PEPPER:
    PIN_PEPPERS[PIN_PEPPER_ID] = PIN_PEPPER

# How long a verification proof stays valid, and the one-time code limits.
STEPUP_TOKEN_TTL_SECONDS = _env_int("FABLE_STEPUP_TOKEN_TTL_SECONDS", 600)
OTP_TTL_SECONDS = _env_int("FABLE_OTP_TTL_SECONDS", 600)
OTP_MAX_ATTEMPTS = _env_int("FABLE_OTP_MAX_ATTEMPTS", 5)

# A contact (email or phone) added or changed within this many hours cannot be
# the factor that releases held money: pointing codes at an address the
# attacker controls is the first move of a session takeover.
CONTACT_SETTLE_HOURS = _env_int("FABLE_CONTACT_SETTLE_HOURS", 24)
# The same rule for sandbox banks, whose money is simulated and whose test
# customers are set up minutes before they are used. A factor set up after a
# hold still never releases it.
SANDBOX_CONTACT_SETTLE_MINUTES = _env_int("FABLE_SANDBOX_CONTACT_SETTLE_MINUTES", 0, minimum=0)

# Ghost: how far back an older client's /v1/ghost/create (no transaction_id) is
# matched to the customer's own recent block, and how long a hold waits once
# the customer has asked their bank to verify them and release it.
GHOST_LEGACY_MATCH_MINUTES = _env_int("GHOST_LEGACY_MATCH_MINUTES", 60)
GHOST_RELEASE_REQUEST_HOURS = _env_int("GHOST_RELEASE_REQUEST_HOURS", 24)

# --- KYC / liveness provider ---
# Unset here. With no provider the identity_check tier resolves to the
# strongest combination actually available (passkey + PIN + emailed code)
# rather than faking a face match.
KYC_PROVIDER_URL = os.getenv("KYC_PROVIDER_URL", "")

# Street addresses for a device's GPS fix. All optional: OpenStreetMap needs no
# key and is always the last resort. Google needs billing on its project;
# LocationIQ and Geoapify have free tiers with no card (show their link).
GOOGLE_MAPS_API_KEY = os.getenv("GOOGLE_MAPS_API_KEY", "").strip()
LOCATIONIQ_API_KEY = os.getenv("LOCATIONIQ_API_KEY", "").strip()
GEOAPIFY_API_KEY = os.getenv("GEOAPIFY_API_KEY", "").strip()

# --- Top-up guards ---
# Add Money writes to the same database the institution's fraud metrics are
# computed from, so it is bounded. Configurable because a sandbox and a pilot
# want different ceilings.
TOPUP_MAX_AMOUNT = float(os.getenv("TOPUP_MAX_AMOUNT", "500000"))
TOPUP_DAILY_MAX = float(os.getenv("TOPUP_DAILY_MAX", "1000000"))
TOPUP_DAILY_COUNT = int(os.getenv("TOPUP_DAILY_COUNT", "5"))

# --- Institution branding ---
# Days a vanity URL is locked after being changed. The slug is a public link
# already shared with customers, so renaming it breaks live URLs; the lock
# makes that deliberate. Set 0 to allow immediate changes.
BRANDING_SLUG_LOCK_DAYS = int(os.getenv("BRANDING_SLUG_LOCK_DAYS", "7"))
# Cap on uploaded logos (bytes). Kept small: these are inlined into the demo
# bank's HTML as data URIs, so a large file would bloat every page load.
BRANDING_MAX_LOGO_BYTES = int(os.getenv("BRANDING_MAX_LOGO_BYTES", "512000"))

# --- WebAuthn (step-up identity verification) ---
# The Relying Party ID must be the site's registered domain (no scheme/port),
# and every origin the browser may present from must be listed. localhost is a
# secure context for WebAuthn, so passkeys work in local development.
WEBAUTHN_RP_ID = os.getenv("WEBAUTHN_RP_ID", "localhost")
_raw_origins_wa = os.getenv("WEBAUTHN_ORIGINS", "http://localhost:3000,http://localhost:3001")
WEBAUTHN_ORIGINS = [o.strip() for o in _raw_origins_wa.split(",") if o.strip()]

# Risk thresholds — the default decision boundary, overridable per deployment.
# Per-channel overrides live in agents/shield/weights.py (FABLE_THRESHOLD_*).
BLOCK_THRESHOLD = float(os.getenv("FABLE_BLOCK_THRESHOLD", "0.8"))
FLAG_THRESHOLD = float(os.getenv("FABLE_FLAG_THRESHOLD", "0.5"))

# Hard ceiling on any single explanation call. The explainer runs off the
# request path, so this does not gate a decision — it stops a hung provider
# from pinning a worker thread indefinitely.
EXPLAINER_TIMEOUT_SECONDS = float(os.getenv("FABLE_EXPLAINER_TIMEOUT", "10"))

# Ghost cooling windows (minutes) by risk score.
#
# Higher risk holds longer on purpose: the window exists so the scam's urgency
# can wear off before the money moves, and the more dangerous the transfer
# looked, the more that pause is worth. The values are kept short enough to be
# watchable end-to-end — a 30-minute hold is correct in production but can't be
# demonstrated live — and every value is overridable per deployment.
GHOST_COOLING_HIGH = int(os.getenv("GHOST_COOLING_HIGH", "15"))   # risk >= 0.9
GHOST_COOLING_MED = int(os.getenv("GHOST_COOLING_MED", "10"))     # risk >= 0.7
GHOST_COOLING_LOW = int(os.getenv("GHOST_COOLING_LOW", "5"))      # risk < 0.7

# --- Scoring detection settings ---
# These decide whether a signal fires at all, not how much it weighs, so the
# Engine page cannot replay them. They are approved settings on the operator
# console's Environment page; these are the built-in defaults.


def _env_float(name: str, default: float) -> float:
    try:
        return float(os.getenv(name, "").strip() or default)
    except ValueError:
        return default


# Transfers within the window that count as a burst, and as a heavy burst.
VELOCITY_WINDOW_MINUTES = _env_int("FABLE_VELOCITY_WINDOW_MIN", 10)
VELOCITY_FLAG_COUNT = _env_int("FABLE_VELOCITY_FLAG", 3)
VELOCITY_HIGH_COUNT = _env_int("FABLE_VELOCITY_HIGH", 5)
# The most a long, clean history can take off a score, and how many clean
# transfers earn all of it.
TENURE_DISCOUNT_MAX = _env_float("FABLE_TENURE_DISCOUNT_MAX", 0.08)
TENURE_FULL_AT = _env_int("FABLE_TENURE_FULL_AT", 120)
# How long a paid recipient stays "known" rather than new.
RECIPIENT_MEMORY_DAYS = _env_int("FABLE_RECIPIENT_MEMORY_DAYS", 540)
