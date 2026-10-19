"""One shape for every error the API returns.

    {"detail": <as before>, "error": "<code>", "message": "<sentence>"}

`detail` is kept exactly as it was, so existing clients keep working; `error`
is a stable code to branch on and `message` a sentence to show. Routes that
already raise a detail like {"error": ..., "message": ...} keep their own code.
"""
from __future__ import annotations

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException as StarletteHTTPException

CODES = {
    400: "bad_request", 401: "unauthorized", 403: "forbidden", 404: "not_found", 405: "method_not_allowed",
    409: "conflict", 410: "gone", 413: "too_large", 415: "unsupported_media_type", 422: "invalid_request",
    429: "rate_limited", 500: "server_error", 501: "not_implemented", 502: "upstream_failed",
    503: "unavailable",
}


def body(status: int, detail) -> dict:
    code = CODES.get(status, "error")
    message = None
    if isinstance(detail, dict):
        code = detail.get("error") or code
        message = detail.get("message")
    elif isinstance(detail, str):
        message = detail
    return {"detail": detail, "error": code, "message": message or "The request could not be completed."}


def install(app: FastAPI) -> None:
    @app.exception_handler(StarletteHTTPException)
    async def _http(request: Request, exc: StarletteHTTPException):
        return JSONResponse(body(exc.status_code, exc.detail), status_code=exc.status_code,
                            headers=getattr(exc, "headers", None))

    @app.exception_handler(RequestValidationError)
    async def _invalid(request: Request, exc: RequestValidationError):
        errors = exc.errors()
        first = errors[0] if errors else {}
        where = ".".join(str(p) for p in first.get("loc", ()) if p not in ("body", "query", "path"))
        message = f"{where}: {first.get('msg')}" if where else (first.get("msg") or "Invalid request.")
        payload = body(422, errors)
        payload["error"], payload["message"] = "invalid_request", message
        return JSONResponse(payload, status_code=422)
