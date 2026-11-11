"""The AI provider clients, built from whatever key is in force right now.

Keys come from core/secrets.get, so a key rotated from the operator console is
picked up within its 30-second refresh with no restart. A client is built once
per (provider, key, timeout) and reused; a new key simply builds a new one.
A missing SDK or key returns None, and callers fall through to the next
provider or to their built-in answer.
"""
from __future__ import annotations

import os
import threading

from core import secrets

_lock = threading.Lock()
_clients: dict[tuple, object] = {}


def _cached(kind: str, key: str, timeout: float, build):
    if not key:
        return None
    ident = (kind, secrets.fingerprint(key), timeout)
    with _lock:
        if ident in _clients:
            return _clients[ident]
    try:
        client = build(key, timeout)
    except Exception:  # noqa: BLE001 - a missing SDK means no client, not an error
        client = None
    with _lock:
        # Old clients for a replaced key are dropped.
        for k in [k for k in _clients if k[0] == kind and k[2] == timeout]:
            _clients.pop(k, None)
        _clients[ident] = client
    return client


def openai(timeout: float = 30):
    def build(key, t):
        from openai import OpenAI

        return OpenAI(api_key=key, timeout=t)

    return _cached("openai", secrets.get("OPENAI_API_KEY"), timeout, build)


def anthropic(timeout: float = 30):
    def build(key, t):
        import anthropic as sdk

        return sdk.Anthropic(api_key=key, timeout=t)

    return _cached("anthropic", secrets.get("ANTHROPIC_API_KEY"), timeout, build)


def huawei(timeout: float = 30):
    """Huawei MaaS through the Forge gateway: OpenAI-compatible, with the team
    key in an `apikey` header. Only set up where FORGE_MAAS_BASE_URL is."""
    base = os.getenv("FORGE_MAAS_BASE_URL", "").strip()
    key = os.getenv("GATEWAY_KEY", "").strip()
    if not base:
        return None

    def build(k, t):
        from openai import OpenAI

        return OpenAI(base_url=base, api_key="unused", default_headers={"apikey": k}, timeout=t)

    return _cached("huawei", key, timeout, build)


def huawei_model() -> str:
    return os.getenv("FORGE_MAAS_MODEL", "").strip() or "glm-5.2"


def openai_model() -> str:
    return secrets.get("OPENAI_MODEL")


def anthropic_model() -> str:
    return secrets.get("ANTHROPIC_MODEL")


def configured() -> bool:
    """Whether any AI provider key is in force (for /health). Never raises."""
    try:
        return bool(secrets.get("ANTHROPIC_API_KEY") or secrets.get("OPENAI_API_KEY")
                    or (os.getenv("FORGE_MAAS_BASE_URL") and os.getenv("GATEWAY_KEY")))
    except Exception:  # noqa: BLE001
        return False
