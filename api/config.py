import os
from dotenv import load_dotenv

load_dotenv()

# --- AI providers for Shield's plain-language explanations ---
# Fable tries Anthropic Claude first, then OpenAI GPT-4o, then a deterministic
# local template. Set at least one key for real AI explanations; with neither
# set the API still returns full risk scores and signals (it never fails the
# request over a missing explainer dependency).
ANTHROPIC_API_KEY = os.getenv("ANTHROPIC_API_KEY", "")
ANTHROPIC_MODEL = os.getenv("ANTHROPIC_MODEL", "claude-opus-4-8")
OPENAI_API_KEY = os.getenv("OPENAI_API_KEY", "")
OPENAI_MODEL = os.getenv("OPENAI_MODEL", "gpt-4o")

ENVIRONMENT = os.getenv("ENVIRONMENT", "development")
# Treat an unset OR empty FABLE_DB_PATH the same: fall back to a real file next
# to this module. An empty value would make SQLite use a throwaway per-connection
# temp DB (nothing persists across requests/restarts), so we guard against it.
DB_PATH = (os.getenv("FABLE_DB_PATH") or "").strip() or os.path.join(os.path.dirname(__file__), "fable.db")

# --- Dashboard & Onboarding ---
FRONTEND_URL = os.getenv("FRONTEND_URL", "http://localhost:3000")
SMTP_SERVER = os.getenv("SMTP_SERVER", "smtp.gmail.com")
SMTP_PORT = int(os.getenv("SMTP_PORT", "587"))
SMTP_USERNAME = os.getenv("SMTP_USERNAME", "")
SMTP_PASSWORD = os.getenv("SMTP_PASSWORD", "")
SMTP_FROM = os.getenv("SMTP_FROM", "Fable Provisioning <no-reply@fable.ng>")

# --- Security / ops (all optional; safe demo defaults) ---
# Comma-separated API keys. If set, protected endpoints require
# `Authorization: Bearer <key>` or `X-API-Key: <key>`. If empty, auth is off
# (demo mode) so judges can call the API with no setup.
_raw_keys = os.getenv("FABLE_API_KEYS", "")
API_KEYS = {k.strip() for k in _raw_keys.split(",") if k.strip()}

# Per-client rate limit (requests / window seconds). Generous by default so it
# never trips during a demo, but present so a burst can't crash the service.
RATE_LIMIT_MAX = int(os.getenv("FABLE_RATE_LIMIT_MAX", "180"))
RATE_LIMIT_WINDOW = int(os.getenv("FABLE_RATE_LIMIT_WINDOW", "60"))

# CORS allowed origins. "*" for the demo; set a comma-separated list in prod.
_raw_origins = os.getenv("FABLE_CORS_ORIGINS", "*")
CORS_ORIGINS = ["*"] if _raw_origins.strip() == "*" else [o.strip() for o in _raw_origins.split(",") if o.strip()]

# Optional Sentry error monitoring.
SENTRY_DSN = os.getenv("SENTRY_DSN", "")

# Risk thresholds
BLOCK_THRESHOLD = 0.8
FLAG_THRESHOLD = 0.5

# Ghost cooling windows (minutes) by risk score
GHOST_COOLING_HIGH = 30    # risk >= 0.9
GHOST_COOLING_MED = 15     # risk >= 0.7
GHOST_COOLING_LOW = 5      # risk < 0.7
