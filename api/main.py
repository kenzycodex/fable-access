import importlib
import logging

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

import config
from middleware.latency import LatencyMiddleware
from middleware.auth import APIKeyMiddleware
from middleware.rate_limit import RateLimitMiddleware

logger = logging.getLogger("fable")

# Optional Sentry error monitoring — only if a DSN is configured.
if config.SENTRY_DSN:
    try:
        import sentry_sdk
        sentry_sdk.init(dsn=config.SENTRY_DSN, environment=config.ENVIRONMENT, traces_sample_rate=0.1)
    except Exception:
        pass

app = FastAPI(
    title="Fable API",
    description="AI security and intelligence infrastructure layer for African finance. "
                "Shield stops scams in real time. Ghost contains the blast radius when a "
                "user overrides a block. Copilot learns each user's genuine habits so safe "
                "transfers stay frictionless.",
    version="1.0.0",
)

# Middleware runs bottom-to-top on the request path: rate limit -> auth -> latency.
app.add_middleware(LatencyMiddleware)
app.add_middleware(APIKeyMiddleware)
app.add_middleware(RateLimitMiddleware)
app.add_middleware(
    CORSMiddleware,
    allow_origins=config.CORS_ORIGINS,
    allow_credentials=config.CORS_ORIGINS != ["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# Register routers resiliently: a missing or broken router module logs a
# warning and is skipped, so one bad module never takes down the whole API.
# `_optional` names are allowed to be absent without a warning.
_ROUTERS = ["shield", "ghost", "copilot", "demo", "dashboard", "assistant", "admin", "auth", "agents", "institutions", "stepup", "branding", "accounts", "transactions", "watch"]
_OPTIONAL = {"watch"}
_loaded: list[str] = []

for name in _ROUTERS:
    try:
        module = importlib.import_module(f"routers.{name}")
        app.include_router(module.router)
        _loaded.append(name)
    except ModuleNotFoundError as exc:
        # A genuinely-absent module: quiet for optional ones, warn otherwise.
        if name in _OPTIONAL and exc.name in (f"routers.{name}", name):
            logger.info("Optional router '%s' not present — skipping.", name)
        else:
            logger.warning("Router '%s' could not be imported: %s", name, exc)
    except Exception as exc:  # noqa: BLE001 — never let one router crash boot
        logger.warning("Router '%s' failed to register: %s", name, exc)

logger.info("Fable API routers loaded: %s", ", ".join(_loaded))

# Resilient loading is right for optional routers and wrong for the scoring
# engine. A failed `routers.shield` import used to produce one WARNING line and
# an API that answered /health with 200 while /v1/shield/analyze returned 404 —
# the entire product absent, with almost no signal. Anything in _REQUIRED is
# load-bearing, so its absence is shouted rather than logged.
_REQUIRED = {"shield", "ghost", "copilot"}
_missing = _REQUIRED - set(_loaded)
if _missing:
    logger.error(
        "CRITICAL: required router(s) failed to load: %s. The API is running "
        "WITHOUT them; /health reports degraded. Check the import traceback "
        "above this line.",
        ", ".join(sorted(_missing)),
    )


# Default demo admin so the pre-filled dashboard login works out of the box.
# Idempotent, and wrapped so it can never crash startup. Provisioning new
# institutions live (POST /admin/provision) still works independently.
DEFAULT_ADMIN_EMAIL = "risk@meridian.ng"
DEFAULT_ADMIN_PASSWORD = "fable-demo"
DEFAULT_ADMIN_INSTITUTION = "meridian"


@app.on_event("startup")
def ensure_default_admin() -> None:
    try:
        from db import cursor
        from utils import hash_password

        with cursor() as cur:
            cur.execute("SELECT 1 FROM admins WHERE email = ?", (DEFAULT_ADMIN_EMAIL,))
            if not cur.fetchone():
                cur.execute(
                    "INSERT INTO admins (email, institution_id, hashed_password) VALUES (?, ?, ?)",
                    (DEFAULT_ADMIN_EMAIL, DEFAULT_ADMIN_INSTITUTION, hash_password(DEFAULT_ADMIN_PASSWORD)),
                )
                logger.info("Seeded default demo admin: %s", DEFAULT_ADMIN_EMAIL)

            # The default tenant predates provisioning — it comes from the
            # multi-tenancy backfill — so it has no API key unless we issue
            # one. Without it the console shows an empty credentials panel
            # and the demo bank can't authenticate as Meridian.
            cur.execute(
                "SELECT 1 FROM api_keys WHERE institution_id = ?", (DEFAULT_ADMIN_INSTITUTION,)
            )
            if not cur.fetchone():
                import secrets

                cur.execute(
                    """INSERT INTO api_keys (key, institution_name, admin_email, institution_id)
                       VALUES (?, ?, ?, ?)""",
                    (
                        f"fbl_live_{secrets.token_hex(16)}",
                        "Meridian MFB",
                        DEFAULT_ADMIN_EMAIL,
                        DEFAULT_ADMIN_INSTITUTION,
                    ),
                )
                logger.info("Issued API key for the default institution.")
    except Exception as exc:  # noqa: BLE001 — never let seeding crash boot
        logger.warning("Could not seed default admin: %s", exc)


@app.get("/health", tags=["system"])
def health():
    """Liveness plus the two things that can be silently wrong.

    A process that answers this endpoint is not necessarily a working fraud
    engine: the scoring router can fail to import, and the scam-pattern library
    can fail to load, both without stopping the app. Reporting "ok" in either
    case is how a broken deploy looks healthy, so both are surfaced here.
    """
    try:
        from agents.shield.patterns import library_health
        patterns = library_health()
    except Exception as exc:  # noqa: BLE001 — health must never itself fail
        patterns = {"healthy": False, "errors": [f"{type(exc).__name__}: {exc}"]}

    degraded = sorted(_REQUIRED - set(_loaded))
    return {
        "status": "degraded" if (degraded or not patterns.get("healthy")) else "ok",
        "service": "fable-api",
        "version": "1.0.0",
        "environment": config.ENVIRONMENT,
        "auth_required": bool(config.API_KEYS),
        "routers": _loaded,
        "missing_required_routers": degraded,
        "pattern_library": patterns,
    }


@app.get("/", tags=["system"])
def root():
    return {"message": "Fable API — see /docs for Swagger documentation."}
