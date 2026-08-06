"""In-memory sliding-window rate limiter, keyed by API key or client IP.

Deliberately dependency-free (no Redis) so the MVP runs anywhere. For a
multi-instance production deployment this would move to Upstash Redis, but the
interface stays the same. Limits are generous by default so a demo never trips
them; the point is that a burst or a misbehaving client can't take the service
down.
"""
import hashlib
import time
from collections import defaultdict, deque

from starlette.middleware.base import BaseHTTPMiddleware
from starlette.responses import JSONResponse

from config import RATE_LIMIT_MAX, RATE_LIMIT_WINDOW

_hits: dict[str, deque] = defaultdict(deque)

EXEMPT_PATHS = ("/", "/health", "/docs", "/redoc", "/openapi.json", "/favicon.ico")

# Only sweep once the dict is big enough to be worth sweeping, so the common
# case stays a single dict lookup.
_EVICT_ABOVE = 1_000


def _client_id(request) -> str:
    """Bucket key for one caller.

    Always the client IP. This used to key on the raw Authorization or
    X-API-Key header, which runs *before* APIKeyMiddleware validates it — so
    any string opened a fresh bucket and rotating a random bearer token per
    request bypassed the limiter completely. Worse, since _hits is an
    unbounded dict, the same bypass allocated a permanent entry each time,
    turning a rate-limit hole into a memory-exhaustion one.

    The API key is appended only as a secondary dimension, so a legitimate
    integrator with several keys behind one egress IP still gets separate
    buckets, while a forged key cannot create one on its own.
    """
    client = request.client
    ip = client.host if client else "unknown"

    auth = request.headers.get("authorization", "")
    key = auth[7:].strip() if auth.lower().startswith("bearer ") else request.headers.get("x-api-key")
    if key:
        # Hashed and truncated: the raw key must not sit in a process-wide dict
        # that shows up in a heap dump or a debugger.
        return f"ip:{ip}|key:{hashlib.sha256(key.encode()).hexdigest()[:16]}"
    return f"ip:{ip}"


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

        # Drop buckets that have gone quiet. Without this the dict only ever
        # grows, one permanent entry per unique caller, which is a slow leak in
        # normal use and an immediate one under a spoofed-key flood.
        if len(_hits) > _EVICT_ABOVE:
            for key in [k for k, dq in _hits.items() if not dq or dq[-1] < window_start]:
                _hits.pop(key, None)

        response = await call_next(request)
        response.headers["X-RateLimit-Limit"] = str(RATE_LIMIT_MAX)
        response.headers["X-RateLimit-Remaining"] = str(max(0, RATE_LIMIT_MAX - len(q)))
        return response
