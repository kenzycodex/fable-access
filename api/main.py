import importlib
import logging
import os
import secrets

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
_ROUTERS = ["shield", "ghost", "copilot", "demo", "dashboard", "assistant", "admin", "auth", "agents", "institutions", "stepup", "branding", "accounts", "transactions", "notifications", "watch"]
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
if config._SESSION_SECRET_IS_EPHEMERAL:
    logger.warning(
        "FABLE_SESSION_SECRET is not set, so a random one was generated for "
        "this process. Console sessions will be invalidated on every restart. "
        "Set it in production: python -c \"import secrets; print(secrets.token_urlsafe(48))\""
    )

if not config.ADMIN_OPERATOR_KEY:
    logger.info("FABLE_OPERATOR_KEY is not set, so POST /admin/provision is disabled.")

_REQUIRED = {"shield", "ghost", "copilot"}
_missing = _REQUIRED - set(_loaded)
if _missing:
    logger.error(
        "CRITICAL: required router(s) failed to load: %s. The API is running "
        "WITHOUT them; /health reports degraded. Check the import traceback "
        "above this line.",
        ", ".join(sorted(_missing)),
    )


# Default demo admin so the console is reachable on a fresh database.
#
# The password used to be the literal "fable-demo", committed to a public
# repository, and created on every startup. Anyone who read the source could
# sign into the demo tenant; chained with the tenant-from-query-parameter hole
# that meant every tenant's data and API key.
#
# It is now taken from the environment, and when unset a random one is
# generated and logged ONCE at startup so a fresh deployment is still usable
# without configuration. Nothing is created if the admin already exists, so an
# existing password is never silently reset.
DEFAULT_ADMIN_EMAIL = os.getenv("FABLE_DEMO_ADMIN_EMAIL", "risk@meridian.ng")
DEFAULT_ADMIN_PASSWORD = os.getenv("FABLE_DEMO_ADMIN_PASSWORD", "").strip()
DEFAULT_ADMIN_INSTITUTION = os.getenv("FABLE_DEMO_ADMIN_INSTITUTION", "meridian")


@app.on_event("startup")
def sweep_expired_containments() -> None:
    """Resolve holds whose cooling window closed while the API was down.

    Without this an abandoned container stayed HELD forever, and its amount was
    subtracted from the customer's available balance with nothing able to
    release it.
    """
    try:
        from agents.ghost.account import sweep_expired

        swept = sweep_expired()
        if swept:
            logger.info("Auto-cancelled %d expired Ghost container(s) at startup.", swept)
    except Exception as exc:  # noqa: BLE001 — never block boot
        logger.warning("Could not sweep expired containments: %s", exc)


@app.on_event("startup")
def ensure_default_admin() -> None:
    try:
        from db import cursor
        from utils import hash_password

        with cursor() as cur:
            cur.execute("SELECT 1 FROM admins WHERE email = ?", (DEFAULT_ADMIN_EMAIL,))
            if not cur.fetchone():
                password = DEFAULT_ADMIN_PASSWORD or secrets.token_urlsafe(12)
                cur.execute(
                    "INSERT INTO admins (email, institution_id, hashed_password) VALUES (?, ?, ?)",
                    (DEFAULT_ADMIN_EMAIL, DEFAULT_ADMIN_INSTITUTION, hash_password(password)),
                )
                if DEFAULT_ADMIN_PASSWORD:
                    logger.info("Seeded demo admin %s from FABLE_DEMO_ADMIN_PASSWORD.", DEFAULT_ADMIN_EMAIL)
                else:
                    # Printed once, on creation only. The hash is all that is
                    # stored, so this line is the only chance to capture it.
                    logger.warning(
                        "Seeded demo admin %s with a GENERATED password: %s\n"
                        "Record it now; it is not recoverable. Set "
                        "FABLE_DEMO_ADMIN_PASSWORD to choose your own.",
                        DEFAULT_ADMIN_EMAIL, password,
                    )

            # The default tenant predates provisioning — it comes from the
            # multi-tenancy backfill — so it has no API key unless we issue
            # one. Without it the console shows an empty credentials panel
            # and the demo bank can't authenticate as Meridian.
            cur.execute(
                "SELECT 1 FROM api_keys WHERE institution_id = ?", (DEFAULT_ADMIN_INSTITUTION,)
            )
            if not cur.fetchone():
                # `secrets` is imported at module scope. A second import here
                # made the name function-local, so the earlier use of
                # secrets.token_urlsafe() above raised UnboundLocalError and
                # the whole seeding step failed with a confusing message.
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
