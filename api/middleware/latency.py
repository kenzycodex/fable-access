import time
from starlette.middleware.base import BaseHTTPMiddleware


class LatencyMiddleware(BaseHTTPMiddleware):
    """Adds X-Fable-Latency-Ms to every response, per the launch checklist."""

    async def dispatch(self, request, call_next):
        start = time.perf_counter()
        response = await call_next(request)
        elapsed_ms = (time.perf_counter() - start) * 1000
        response.headers["X-Fable-Latency-Ms"] = f"{elapsed_ms:.2f}"
        return response
