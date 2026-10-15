import importlib
import logging
import os
import secrets
from contextlib import asynccontextmanager

from fastapi import FastAPI
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

# Optional Sentry error monitoring — only if a DSN is configured.
if config.SENTRY_DSN:
    try:
        import sentry_sdk
        sentry_sdk.init(dsn=config.SENTRY_DSN, environment=config.ENVIRONMENT, traces_sample_rate=0.1,
                        before_send=scrub_event)
    except Exception:
        pass

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
        engine_admin.sweep()
    except Exception as exc:  # noqa: BLE001 - never block startup on this
        logger.warning("Could not prepare engine versions at startup: %s", type(exc).__name__)
    yield


app = FastAPI(
    lifespan=lifespan,
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

if config.ENVIRONMENT == "production" and config.WEBAUTHN_RP_ID == "localhost":
    logger.error(
        "WEBAUTHN_RP_ID is still 'localhost' in production. Every passkey "
        "registration and assertion will fail origin validation, silently "
        "pushing all step-up onto the weaker PIN/OTP path. Set it to the "
        "site's registered domain (no scheme, no port)."
    )

if config.ENVIRONMENT == "production" and not config.SECRETS_KEY:
    logger.warning(
        "FABLE_SECRETS_KEY is not set, so integration keys can only come from .env and the "
        "operator console's Secrets page is read-only. To enable it: "
        "python -c \"import secrets,base64;print(base64.urlsafe_b64encode(secrets.token_bytes(32)).decode())\""
    )

if config.ENVIRONMENT == "production" and not config.PIN_PEPPER:
    logger.warning(
        "FABLE_PIN_PEPPER is not set, so customer PIN hashes have no server-held "
        "key and could be guessed offline from a copy of the database. Set it, "
        "and keep a copy offline: losing it locks every PIN. "
        "python -c \"import secrets; print(secrets.token_urlsafe(32))\""
    )

if config.ENVIRONMENT == "production" and config.CORS_ORIGINS == ["*"]:
    logger.warning(
        "FABLE_CORS_ORIGINS is '*' in production, so any website can call this "
        "API from a visitor's browser. Set it to your frontend origins, comma-"
        "separated (for example https://fablehq.vercel.app)."
    )

if config.ENVIRONMENT == "production" and os.getenv("FABLE_WEBHOOK_ALLOW_PRIVATE", "").lower() in ("1", "true", "yes"):
    logger.error(
        "FABLE_WEBHOOK_ALLOW_PRIVATE is on in production. A console user could "
        "point a webhook at this server's own network. Turn it off."
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
            logger.info("Auto-cancelled %d expired Ghost container(s) at startup.", swept)
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
