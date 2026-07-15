"""In-memory sliding-window rate limiter, keyed by API key or client IP.

Deliberately dependency-free (no Redis) so the MVP runs anywhere. For a
multi-instance production deployment this would move to Upstash Redis, but the
interface stays the same. Limits are generous by default so a demo never trips
them; the point is that a burst or a misbehaving client can't take the service
down.
"""
import time
from collections import defaultdict, deque

from starlette.middleware.base import BaseHTTPMiddleware
from starlette.responses import JSONResponse

from config import RATE_LIMIT_MAX, RATE_LIMIT_WINDOW

_hits: dict[str, deque] = defaultdict(deque)

EXEMPT_PATHS = ("/", "/health", "/docs", "/redoc", "/openapi.json", "/favicon.ico")


def _client_id(request) -> str:
    auth = request.headers.get("authorization", "")
    if auth.lower().startswith("bearer "):
        return f"key:{auth[7:].strip()}"
    key = request.headers.get("x-api-key")
    if key:
        return f"key:{key}"
    client = request.client
    return f"ip:{client.host if client else 'unknown'}"


class RateLimitMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request, call_next):
        if request.url.path in EXEMPT_PATHS or request.method == "OPTIONS":
            return await call_next(request)

        cid = _client_id(request)
        now = time.time()
        window_start = now - RATE_LIMIT_WINDOW
        q = _hits[cid]

        while q and q[0] < window_start:
            q.popleft()

        if len(q) >= RATE_LIMIT_MAX:
            retry_after = int(q[0] + RATE_LIMIT_WINDOW - now) + 1
            return JSONResponse(
                status_code=429,
                content={"detail": "Rate limit exceeded. Slow down."},
                headers={"Retry-After": str(retry_after)},
            )

        q.append(now)
        response = await call_next(request)
        response.headers["X-RateLimit-Limit"] = str(RATE_LIMIT_MAX)
        response.headers["X-RateLimit-Remaining"] = str(max(0, RATE_LIMIT_MAX - len(q)))
        return response
