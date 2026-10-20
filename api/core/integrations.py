"""Where the code reads integration settings that an operator can change.

Each value comes from the server environment, else the value approved in the
operator console, else the built-in default (core/secrets.setting / get). Read
them here, at the moment of use, so an approved change applies without a
restart. CORS origins and the Sentry DSN are read once at startup.
"""
from __future__ import annotations

from core import config
from core import secrets as vault


def _safe(fn, default):
    try:
        value = fn()
    except Exception:  # noqa: BLE001 - settings must never break the caller
        return default
    return default if value in (None, "") else value


def frontend_url() -> str:
    return str(_safe(lambda: vault.setting("FRONTEND_URL"), config.FRONTEND_URL)).rstrip("/")


def smtp() -> dict:
    return {
        "server": _safe(lambda: vault.setting("SMTP_SERVER"), config.SMTP_SERVER),
        "port": int(_safe(lambda: vault.setting("SMTP_PORT"), config.SMTP_PORT)),
        "username": _safe(lambda: vault.setting("SMTP_USERNAME"), config.SMTP_USERNAME),
        "password": _safe(lambda: vault.get("SMTP_PASSWORD"), config.SMTP_PASSWORD),
        "from": _safe(lambda: vault.setting("SMTP_FROM"), config.SMTP_FROM),
    }


def sms() -> dict:
    return {
        "provider": str(_safe(lambda: vault.setting("SMS_PROVIDER"), config.SMS_PROVIDER)).lower(),
        "termii_api_key": _safe(lambda: vault.get("TERMII_API_KEY"), ""),
        "sender_id": _safe(lambda: vault.setting("SMS_SENDER_ID"), config.SMS_SENDER_ID),
        "termii_base_url": config.TERMII_BASE_URL,
        "africastalking_api_key": _safe(lambda: vault.get("AFRICASTALKING_API_KEY"), ""),
        "africastalking_username": _safe(lambda: vault.setting("AFRICASTALKING_USERNAME"),
                                         config.AFRICASTALKING_USERNAME),
        "africastalking_env": str(_safe(lambda: vault.setting("AFRICASTALKING_ENV"),
                                        config.AFRICASTALKING_ENV)).lower(),
    }


def sentry_dsn() -> str:
    return _safe(lambda: vault.get("SENTRY_DSN"), config.SENTRY_DSN)


def cors_origins() -> list[str]:
    raw = str(_safe(lambda: vault.setting("FABLE_CORS_ORIGINS"), config.CORS_ORIGINS_RAW)).strip()
    return ["*"] if raw == "*" else [o.strip() for o in raw.split(",") if o.strip()]
