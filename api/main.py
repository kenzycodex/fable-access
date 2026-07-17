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
_ROUTERS = ["shield", "ghost", "copilot", "demo", "dashboard", "assistant", "admin", "auth", "watch"]
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
            if cur.fetchone():
                return
            cur.execute(
                "INSERT INTO admins (email, institution_id, hashed_password) VALUES (?, ?, ?)",
                (DEFAULT_ADMIN_EMAIL, DEFAULT_ADMIN_INSTITUTION, hash_password(DEFAULT_ADMIN_PASSWORD)),
            )
        logger.info("Seeded default demo admin: %s", DEFAULT_ADMIN_EMAIL)
    except Exception as exc:  # noqa: BLE001 — never let seeding crash boot
        logger.warning("Could not seed default admin: %s", exc)


@app.get("/health", tags=["system"])
def health():
    return {
        "status": "ok",
        "service": "fable-api",
        "version": "1.0.0",
        "environment": config.ENVIRONMENT,
        "auth_required": bool(config.API_KEYS),
        "routers": _loaded,
    }


@app.get("/", tags=["system"])
def root():
    return {"message": "Fable API — see /docs for Swagger documentation."}
