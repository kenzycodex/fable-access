"""Opt-in API-key authentication.

If FABLE_API_KEYS is configured, every request to a protected path must carry a
valid key via `Authorization: Bearer <key>` or `X-API-Key: <key>`. If no keys
are configured the middleware is a no-op (demo mode) so the API works with zero
setup. Health, docs, root and the OpenAPI schema are always public.
"""
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.responses import JSONResponse

from config import API_KEYS
from db import get_conn

PUBLIC_PATHS = ("/", "/health", "/docs", "/redoc", "/openapi.json", "/favicon.ico")


def _extract_key(request) -> str | None:
    auth = request.headers.get("authorization", "")
    if auth.lower().startswith("bearer "):
        return auth[7:].strip()
    return request.headers.get("x-api-key")


class APIKeyMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request, call_next):
        if not API_KEYS:
            return await call_next(request)  # demo mode: auth disabled

        path = request.url.path
        if path in PUBLIC_PATHS or request.method == "OPTIONS":
            return await call_next(request)

        key = _extract_key(request)
        if not key:
            return JSONResponse(
                status_code=401,
                content={"detail": "Invalid or missing API key. Send Authorization: Bearer <key>."},
            )

        # Check static config keys first (e.g. for hardcoded demo keys)
        if key in API_KEYS:
            return await call_next(request)

        # If not in static config, check the database for provisioned keys
        conn = get_conn()
        cur = conn.execute("SELECT 1 FROM api_keys WHERE key = ? AND is_active = 1", (key,))
        if cur.fetchone() is not None:
            return await call_next(request)

        return JSONResponse(
            status_code=401,
            content={"detail": "Invalid or missing API key. Send Authorization: Bearer <key>."},
        )
