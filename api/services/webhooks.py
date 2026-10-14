"""Outbound webhooks.

An institution registers an HTTPS endpoint and the events it wants. When one of
those events happens, Fable POSTs a JSON body to it, signed so the receiver can
prove the call came from Fable and was not replayed:

    Fable-Signature: t=<unix seconds>,v1=<hex HMAC-SHA256(secret, "<t>.<body>")>

Delivery runs on a small thread pool, off the request path: a slow or broken
receiver must never slow down a transfer decision. Each delivery is attempted up
to three times with backoff, and every attempt is recorded so the console can
show what happened.

Targets must be public HTTPS. A URL that resolves to a private, loopback or
link-local address is refused, because otherwise any console user could make the
API server call into its own network (SSRF). Local development can opt out with
FABLE_WEBHOOK_ALLOW_PRIVATE=1.
"""
import hashlib
import hmac
import ipaddress
import json
import logging
import os
import secrets
import socket
import time
import urllib.error
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
from urllib.parse import urlparse

from core.db import cursor, row_to_dict

logger = logging.getLogger("fable.webhooks")

EVENTS = (
    "transaction.flagged",
    "transaction.blocked",
    "containment.created",
    "containment.resolved",
    "case.resolved",
)

ATTEMPTS = 3
TIMEOUT_SECONDS = 5

_pool = ThreadPoolExecutor(max_workers=4, thread_name_prefix="fable-webhook")


class WebhookError(ValueError):
    """A webhook URL or configuration that cannot be accepted."""


def _allow_private() -> bool:
    return os.getenv("FABLE_WEBHOOK_ALLOW_PRIVATE", "").lower() in ("1", "true", "yes")


def validate_url(url: str) -> str:
    """Return the URL if Fable may deliver to it, else raise WebhookError."""
    url = (url or "").strip()
    parsed = urlparse(url)
    if parsed.scheme not in ("https", "http") or not parsed.hostname:
        raise WebhookError("Enter a full URL, starting with https://")
    if len(url) > 500:
        raise WebhookError("That URL is too long.")
    if _allow_private():
        return url
    if parsed.scheme != "https":
        raise WebhookError("Webhook URLs must use https.")
    try:
        infos = socket.getaddrinfo(parsed.hostname, parsed.port or 443, proto=socket.IPPROTO_TCP)
    except socket.gaierror as exc:
        raise WebhookError("That host name does not resolve.") from exc
    for info in infos:
        ip = ipaddress.ip_address(info[4][0])
        if ip.is_private or ip.is_loopback or ip.is_link_local or ip.is_reserved or ip.is_multicast:
            raise WebhookError("Webhooks cannot point at a private or internal address.")
    return url


def sign(secret: str, timestamp: int, body: bytes) -> str:
    mac = hmac.new(secret.encode(), f"{timestamp}.".encode() + body, hashlib.sha256)
    return f"t={timestamp},v1={mac.hexdigest()}"


def new_secret() -> str:
    return "whsec_" + secrets.token_hex(24)


def _record(hook: dict, event: str, attempt: int, status: int | None, ok: bool, error: str | None) -> None:
    try:
        with cursor() as cur:
            cur.execute(
                """INSERT INTO webhook_deliveries
                   (webhook_id, institution_id, event, status_code, ok, error, attempt)
                   VALUES (?, ?, ?, ?, ?, ?, ?)""",
                (hook["id"], hook["institution_id"], event, status, 1 if ok else 0, error, attempt),
            )
    except Exception as exc:  # noqa: BLE001 - recording must never break delivery
        logger.warning("Could not record webhook delivery: %s", exc)


def _post(url: str, body: bytes, headers: dict) -> int:
    req = urllib.request.Request(url, data=body, headers=headers, method="POST")
    try:
        with urllib.request.urlopen(req, timeout=TIMEOUT_SECONDS) as resp:  # noqa: S310 - validated URL
            return resp.status
    except urllib.error.HTTPError as exc:
        return exc.code


def deliver(hook: dict, event: str, data: dict, *, sleep=time.sleep) -> bool:
    """Send one event to one endpoint, retrying. Returns whether it landed."""
    payload = {
        "id": "evt_" + secrets.token_hex(10),
        "type": event,
        "created_at": datetime.now(timezone.utc).isoformat(),
        "institution_id": hook["institution_id"],
        "data": data,
    }
    body = json.dumps(payload, separators=(",", ":"), default=str).encode()

    for attempt in range(1, ATTEMPTS + 1):
        ts = int(time.time())
        headers = {
            "Content-Type": "application/json",
            "User-Agent": "Fable-Webhooks/1.0",
            "Fable-Event": event,
            "Fable-Signature": sign(hook["secret"], ts, body),
        }
        try:
            # Re-checked on every attempt: DNS can change between registration
            # and delivery, which is the classic way around an SSRF check.
            validate_url(hook["url"])
            status = _post(hook["url"], body, headers)
            ok = 200 <= status < 300
            _record(hook, event, attempt, status, ok, None if ok else f"HTTP {status}")
            if ok:
                return True
            if 400 <= status < 500 and status not in (408, 429):
                return False  # the receiver rejected it; retrying won't help
        except WebhookError as exc:
            _record(hook, event, attempt, None, False, str(exc))
            return False
        except Exception as exc:  # noqa: BLE001 - network errors of every kind
            _record(hook, event, attempt, None, False, type(exc).__name__)
        if attempt < ATTEMPTS:
            sleep(2 ** attempt)
    return False


def hooks_for(institution_id: str, event: str) -> list[dict]:
    with cursor() as cur:
        cur.execute(
            "SELECT id, institution_id, url, secret, events FROM webhooks WHERE institution_id = ? AND active = 1",
            (institution_id,),
        )
        rows = [row_to_dict(r) for r in cur.fetchall()]
    return [r for r in rows if event in (r["events"] or "").split(",")]


def emit(institution_id: str | None, event: str, data: dict) -> None:
    """Queue `event` for every endpoint this institution subscribed to it.

    Never raises and never blocks: a webhook problem must not fail the action
    that triggered it.
    """
    if not institution_id or event not in EVENTS:
        return
    try:
        for hook in hooks_for(institution_id, event):
            _pool.submit(deliver, hook, event, data)
    except Exception as exc:  # noqa: BLE001
        logger.warning("Webhook emit failed for %s: %s", event, exc)


def transaction_summary(row: dict) -> dict:
    """The fields a receiver needs about a transaction, and nothing more.

    No device fingerprint, IP or location: the receiver is the bank's own
    system, which already has the transfer, and these are the identifiers that
    matter if a webhook endpoint is ever compromised.
    """
    keys = (
        "id", "user_id", "amount", "recipient_account", "recipient_bank", "channel",
        "risk_score", "action_taken", "status", "created_at",
    )
    return {k: row.get(k) for k in keys if k in row}
