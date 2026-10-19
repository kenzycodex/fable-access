import importlib
import logging
import os
import secrets
from contextlib import asynccontextmanager

from fastapi import FastAPI, Response
from fastapi.middleware.cors import CORSMiddleware

from core import config
from middleware.auth import APIKeyMiddleware
from middleware.latency import LatencyMiddleware
from middleware.rate_limit import RateLimitMiddleware

logger = logging.getLogger("fable")

# No log line, and no error report, ever carries an integration key: every
# record passes through the scrubber, which removes any key the process has
# loaded and anything shaped like a provider key.
from core.secrets import ScrubFilter, scrub_event  # noqa: E402

for _handler in logging.getLogger().handlers or []:
    _handler.addFilter(ScrubFilter())
logging.getLogger().addFilter(ScrubFilter())
for _name in ("fable", "uvicorn", "uvicorn.error", "uvicorn.access"):
    logging.getLogger(_name).addFilter(ScrubFilter())

# Optional Sentry error monitoring, only if a DSN is configured (environment,
# or approved in the operator console; a change applies after a restart).
from core import integrations  # noqa: E402

_SENTRY_DSN = integrations.sentry_dsn()
if _SENTRY_DSN:
    try:
        import sentry_sdk
        sentry_sdk.init(dsn=_SENTRY_DSN, environment=config.ENVIRONMENT, traces_sample_rate=0.1,
                        before_send=scrub_event)
    except Exception:
        pass

# Read once at startup, from the environment or the console.
CORS_ORIGINS = integrations.cors_origins()

@asynccontextmanager
async def lifespan(_app: FastAPI):
    """Work to do once at startup. FastAPI deprecated @app.on_event for this.

    The functions are defined further down; they exist by the time this runs.
    """
    sweep_expired_containments()
    note_if_no_admins()
    try:
        from services import secret_admin

        secret_admin.sweep()  # apply finished cooling-off periods, expire stale proposals
    except Exception as exc:  # noqa: BLE001 - never block startup on this
        logger.warning("Could not sweep integration-key changes at startup: %s", type(exc).__name__)
    try:
        from core import engine_config
        from services import engine_admin

        engine_config.seed_if_empty()  # version 1 = the weights and thresholds in force today
        drafted = engine_config.seed_cold_start_draft()
        if drafted:
            logger.info("Engine v%s drafted with the no-history amount weights; review it on the Engine page.", drafted)
        engine_admin.sweep()
    except Exception as exc:  # noqa: BLE001 - never block startup on this
        logger.warning("Could not prepare engine versions at startup: %s", type(exc).__name__)
    from services import scheduler

    register_jobs()
    scheduler.start()
    yield
    scheduler.stop()


def register_jobs() -> None:
    """The background jobs (services/scheduler.py). Each is idempotent."""
    from agents.ghost.account import sweep_expired
    from services import engine_admin, retention, scheduler, webhooks

    scheduler.register("ghost_expiry", 30, sweep_expired)
    scheduler.register("webhook_outbox", 15, webhooks.drain)
    scheduler.register("engine_sweep", 600, engine_admin.sweep)
    scheduler.register("retention", 6 * 3600, retention.apply)


app = FastAPI(
    lifespan=lifespan,
    title="Fable API",
    description="Behavioural fraud-risk scoring for Nigerian transfers. Copilot learns each "
                "customer's habits, Shield scores a transfer against them before it is sent, and "
                "Ghost holds a blocked transfer the customer insists on, where they can still cancel it.",
    version="1.0.0",
)

# Middleware runs bottom-to-top on the request path: rate limit -> auth -> latency.
app.add_middleware(LatencyMiddleware)
app.add_middleware(APIKeyMiddleware)
app.add_middleware(RateLimitMiddleware)
app.add_middleware(
    CORSMiddleware,
    allow_origins=CORS_ORIGINS,
    allow_credentials=CORS_ORIGINS != ["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# Register routers resiliently: a missing or broken router module logs a
# warning and is skipped, so one bad module never takes down the whole API.
# `_optional` names are allowed to be absent without a warning.
_ROUTERS = ["shield", "ghost", "copilot", "dashboard", "assistant", "auth", "agents", "institutions", "stepup", "branding", "accounts", "transactions", "notifications", "review", "team", "webhooks", "geo", "sandbox", "customers", "imports", "onboarding", "operator", "operator_secrets", "operator_engine"]
_OPTIONAL: set[str] = set()
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

def production_problems(cors_origins: list[str] | None = None) -> list[str]:
    """Settings that are unsafe in production. In production the API refuses
    to start while any of these remain; in development they are warnings."""
    problems = []
    if config._SESSION_SECRET_IS_EPHEMERAL:
        problems.append("FABLE_SESSION_SECRET is not set (sessions would die on every restart).")
    if (cors_origins if cors_origins is not None else CORS_ORIGINS) == ["*"]:
        problems.append("FABLE_CORS_ORIGINS is '*' (any website could call the API from a visitor's browser).")
    if not config.PIN_PEPPER:
        problems.append("FABLE_PIN_PEPPER is not set (PIN hashes could be guessed offline from a database copy).")
    if config.WEBAUTHN_RP_ID == "localhost":
        problems.append("WEBAUTHN_RP_ID is 'localhost' (every passkey would fail).")
    if os.getenv("FABLE_WEBHOOK_ALLOW_PRIVATE", "").lower() in ("1", "true", "yes"):
        problems.append("FABLE_WEBHOOK_ALLOW_PRIVATE is on (webhooks could reach the server's own network).")
    return problems


_PROBLEMS = production_problems()
if config.ENVIRONMENT == "production" and _PROBLEMS:
    for _problem in _PROBLEMS:
        logger.critical("Refusing to start in production: %s", _problem)
    raise SystemExit("Unsafe production settings: " + " ".join(_PROBLEMS))
for _problem in _PROBLEMS:
    logger.warning("Not safe for production: %s", _problem)

if config.ENVIRONMENT == "production" and not config.SECRETS_KEY:
    logger.warning(
        "FABLE_SECRETS_KEY is not set, so integration keys can only come from .env and the "
        "operator console's Secrets page is read-only. To enable it: "
        "python -c \"import secrets,base64;print(base64.urlsafe_b64encode(secrets.token_bytes(32)).decode())\""
    )

_REQUIRED = {"shield", "ghost", "copilot"}
_missing = _REQUIRED - set(_loaded)
if _missing:
    logger.error(
        "CRITICAL: required router(s) failed to load: %s. The API is running "
        "WITHOUT them; /health reports degraded. Check the import traceback "
        "above this line.",
        ", ".join(sorted(_missing)),
    )


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
            logger.info("Expired %d Ghost hold(s) whose window closed while the API was down.", swept)
    except Exception as exc:  # noqa: BLE001 — never block boot
        logger.warning("Could not sweep expired containments: %s", exc)


def note_if_no_admins() -> None:
    """Say how to create the first institution when the database has none.

    Startup used to seed a "Meridian MFB" institution, a console admin and an
    API key into an empty database, with a default email and a password from the
    environment. Nothing is created automatically now: every institution, with
    its owner login and API key, comes from provisioning, so no deployment ships
    with a known account.
    """
    try:
        from core.db import cursor

        with cursor() as cur:
            cur.execute("SELECT 1 FROM admins LIMIT 1")
            if cur.fetchone():
                return
        logger.info(
            "No institution exists yet. Create a Fable operator on the server with "
            "`python scripts/create_operator.py`, sign in at /operator, and provision "
            "the first institution there."
        )
    except Exception as exc:  # noqa: BLE001 - never block boot
        logger.warning("Could not check for console admins: %s", exc)


@app.get("/health", tags=["system"])
def health(response: Response):
    """Liveness plus the things that can be silently wrong.

    A process that answers this endpoint is not necessarily a working fraud
    engine: the scoring router can fail to import, the scam-pattern library can
    fail to load and the database can be unreachable, all without stopping the
    app. Any of those is "degraded" with HTTP 503, so the deploy script and the
    container health check stop trusting the process.

    Background work (the scheduler and the webhook outbox) is reported as
    warnings with a 200: a late expiry sweep or a slow bank endpoint is worth
    seeing, but is not a reason to restart the scoring engine.
    """
    try:
        from agents.shield.patterns import library_health
        patterns = library_health()
    except Exception as exc:  # noqa: BLE001 — health must never itself fail
        patterns = {"healthy": False, "errors": [f"{type(exc).__name__}: {exc}"]}

    try:
        from core.db import cursor

        with cursor() as cur:
            cur.execute("SELECT 1")
            cur.fetchone()
        database = {"healthy": True}
    except Exception as exc:  # noqa: BLE001
        database = {"healthy": False, "error": type(exc).__name__}

    warnings: list[str] = []
    try:
        from services import scheduler

        jobs = scheduler.status()
        if jobs["enabled"] and not jobs["running"]:
            warnings.append("The scheduler is not running.")
        if jobs["stale"]:
            warnings.append("Background jobs are late: " + ", ".join(jobs["stale"]))
    except Exception as exc:  # noqa: BLE001
        jobs = {"error": type(exc).__name__}
    try:
        from services import webhooks

        outbox = webhooks.outbox_status()
        if outbox["failed"]:
            warnings.append(f"{outbox['failed']} webhook deliveries gave up.")
    except Exception as exc:  # noqa: BLE001
        outbox = {"error": type(exc).__name__}
    try:
        from core import ai_clients

        # The decision never waits for prose; without a key, templates are used.
        explainer = {"llm_configured": ai_clients.configured(), "fallback": "templates"}
    except Exception:  # noqa: BLE001
        explainer = {"llm_configured": None}

    degraded = sorted(_REQUIRED - set(_loaded))
    bad = bool(degraded or not patterns.get("healthy") or not database["healthy"])
    if bad:
        response.status_code = 503
    return {
        "status": "degraded" if bad else "ok",
        "service": "fable-api",
        "version": "1.0.0",
        "environment": config.ENVIRONMENT,
        "auth_required": bool(config.API_KEYS),
        "routers": _loaded,
        "missing_required_routers": degraded,
        "pattern_library": patterns,
        "database": database,
        "scheduler": jobs,
        "webhook_outbox": outbox,
        "explainer": explainer,
        "warnings": warnings,
    }


@app.get("/", tags=["system"])
def root():
    return {"message": "Fable API — see /docs for Swagger documentation."}
