"""Outbound webhooks.

An institution registers an HTTPS endpoint and the events it wants. When one of
those events happens, Fable POSTs a JSON body to it, signed so the receiver can
prove the call came from Fable and was not replayed:

    Fable-Signature: t=<unix seconds>,v1=<hex HMAC-SHA256(secret, "<t>.<body>")>

Every event is first written to an outbox table (webhook_outbox) with a fixed
event id, then delivered off the request path: a slow or broken receiver must
never slow down a transfer decision. A failed delivery is retried from the
outbox with growing gaps (up to MAX_ATTEMPTS, about a day in all) by the
scheduler, so a restart no longer loses a retry. Every attempt is recorded so
the console can show what happened. Receivers should de-duplicate on the
event id, since an event can arrive more than once.

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
    "transaction.passed",
    "transaction.flagged",
    "transaction.blocked",
    "transaction.approved",
    "containment.created",
    "containment.released",
    "containment.cancelled",
    "containment.expired",
    "containment.release_requested",
    # Kept for endpoints subscribed before the three events above existed;
    # still sent alongside them, with an "outcome" field.
    "containment.resolved",
    "case.resolved",
)

ATTEMPTS = 3            # for a direct delivery (the console's test send)
MAX_ATTEMPTS = 8        # for an outbox delivery, spread over about a day
TIMEOUT_SECONDS = 5
STALE_CLAIM_SECONDS = 300

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


def _payload(institution_id: str, event: str, data: dict) -> dict:
    return {
        "id": "evt_" + secrets.token_hex(10),
        "type": event,
        "created_at": datetime.now(timezone.utc).isoformat(),
        "institution_id": institution_id,
        "data": data,
    }


def _attempt(hook: dict, event: str, body: bytes, attempt: int) -> tuple[bool, bool]:
    """One delivery attempt. (landed, worth retrying)."""
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
            return True, False
        # The receiver rejected it; retrying won't help, except for these.
        return False, not (400 <= status < 500 and status not in (408, 429))
    except WebhookError as exc:
        _record(hook, event, attempt, None, False, str(exc))
        return False, False
    except Exception as exc:  # noqa: BLE001 - network errors of every kind
        _record(hook, event, attempt, None, False, type(exc).__name__)
        return False, True


def deliver(hook: dict, event: str, data: dict, *, sleep=time.sleep) -> bool:
    """Send one event to one endpoint now, retrying briefly. Returns whether it
    landed. Used for the console's test send; real events go through the
    outbox (emit)."""
    body = json.dumps(_payload(hook["institution_id"], event, data), separators=(",", ":"), default=str).encode()
    for attempt in range(1, ATTEMPTS + 1):
        ok, retry = _attempt(hook, event, body, attempt)
        if ok:
            return True
        if not retry:
            return False
        if attempt < ATTEMPTS:
            sleep(2 ** attempt)
    return False


def hooks_for(institution_id: str, event: str) -> list[dict]:
    with cursor() as cur:
        cur.execute(
            "SELECT id, institution_id, url, secret, events, secret_ciphertext, secret_nonce, secret_wrapped, "
            "secret_kid FROM webhooks WHERE institution_id = ? AND active = 1",
            (institution_id,),
        )
        rows = [row_to_dict(r) for r in cur.fetchall()]
    return [with_secret(r) for r in rows if event in (r["events"] or "").split(",")]


def seal_secret(hook_id: str, secret: str) -> dict:
    """Columns to store for a signing secret: encrypted when the master key is
    set (secret column emptied), plain otherwise, as before."""
    from core import secrets as vault

    if vault.master_key() is None:
        return {"secret": secret, "secret_ciphertext": None, "secret_nonce": None, "secret_wrapped": None,
                "secret_kid": None}
    sealed = vault.seal(secret, f"webhook:{hook_id}", 1, "webhook")
    return {"secret": "", "secret_ciphertext": sealed["ciphertext"], "secret_nonce": sealed["nonce"],
            "secret_wrapped": sealed["wrapped_key"], "secret_kid": sealed["kid"]}


def with_secret(row: dict) -> dict:
    """The endpoint with its signing secret ready to use (decrypted if sealed)."""
    if row.get("secret") or not row.get("secret_ciphertext"):
        return row
    from core import secrets as vault

    plain = vault.open_sealed({"ciphertext": row["secret_ciphertext"], "nonce": row["secret_nonce"],
                               "wrapped_key": row["secret_wrapped"], "kid": row.get("secret_kid")},
                              f"webhook:{row['id']}", 1, "webhook")
    return {**row, "secret": plain}


def _hook(webhook_id: str) -> dict | None:
    with cursor() as cur:
        cur.execute("SELECT id, institution_id, url, secret, events, active, secret_ciphertext, secret_nonce, "
                    "secret_wrapped, secret_kid FROM webhooks WHERE id = ?",
                    (webhook_id,))
        row = row_to_dict(cur.fetchone())
    return with_secret(row) if row else None


def emit(institution_id: str | None, event: str, data: dict) -> None:
    """Record `event` for every endpoint this institution subscribed to it, then
    start delivering it.

    The outbox row is the promise: if delivery fails, or the process restarts,
    the scheduler picks it up again. Never raises and never blocks: a webhook
    problem must not fail the action that triggered it.
    """
    if not institution_id or event not in EVENTS:
        return
    try:
        ids = []
        with cursor() as cur:
            for hook in hooks_for(institution_id, event):
                payload = _payload(institution_id, event, data)
                cur.execute(
                    """INSERT INTO webhook_outbox (webhook_id, institution_id, event, event_id, payload)
                       VALUES (?, ?, ?, ?, ?)""",
                    (hook["id"], institution_id, event, payload["id"],
                     json.dumps(payload, separators=(",", ":"), default=str)),
                )
                ids.append(cur.lastrowid)
        for row_id in ids:
            _pool.submit(deliver_outbox_row, row_id)
    except Exception as exc:  # noqa: BLE001
        logger.warning("Webhook emit failed for %s: %s", event, exc)


def _backoff(attempts: int) -> float:
    """Seconds before the next try: 30 s, 1 min, 2 min ... capped at 6 hours."""
    return float(min(30 * 2 ** max(attempts - 1, 0), 6 * 3600))


def deliver_outbox_row(row_id: int) -> str | None:
    """Try one outbox row once, if it is due and nobody else is on it.
    Returns its new status, or None when it was not claimed."""
    now = time.time()
    with cursor() as cur:
        cur.execute(
            "UPDATE webhook_outbox SET status = 'sending', claimed_at = ? "
            "WHERE id = ? AND status = 'pending' AND next_attempt_at <= ?",
            (now, row_id, now),
        )
        if not cur.rowcount:
            return None
        cur.execute("SELECT * FROM webhook_outbox WHERE id = ?", (row_id,))
        row = row_to_dict(cur.fetchone())

    hook = _hook(row["webhook_id"])
    attempts = (row["attempts"] or 0) + 1
    if not hook or not hook.get("active"):
        status, ok, retry, error = "failed", False, False, "endpoint removed or paused"
    else:
        ok, retry = _attempt(hook, row["event"], row["payload"].encode(), attempts)
        status = "delivered" if ok else ("pending" if retry and attempts < MAX_ATTEMPTS else "failed")
        error = None if ok else "will retry" if status == "pending" else "gave up"
    with cursor() as cur:
        cur.execute(
            """UPDATE webhook_outbox SET status = ?, attempts = ?, next_attempt_at = ?, claimed_at = NULL,
                      last_error = ?, delivered_at = CASE WHEN ? = 'delivered' THEN datetime('now') END
               WHERE id = ?""",
            (status, attempts, time.time() + _backoff(attempts), error, status, row_id),
        )
    return status


def drain(limit: int = 100) -> int:
    """Deliver what is due. Run by the scheduler; safe to run anywhere, any
    number of times. Returns how many rows were attempted."""
    now = time.time()
    with cursor() as cur:
        # A worker that died mid-delivery leaves its row claimed; give it back.
        cur.execute("UPDATE webhook_outbox SET status = 'pending', claimed_at = NULL "
                    "WHERE status = 'sending' AND claimed_at < ?", (now - STALE_CLAIM_SECONDS,))
        cur.execute("SELECT id FROM webhook_outbox WHERE status = 'pending' AND next_attempt_at <= ? "
                    "ORDER BY id LIMIT ?", (now, limit))
        ids = [r["id"] for r in cur.fetchall()]
    done = 0
    for row_id in ids:
        if deliver_outbox_row(row_id) is not None:
            done += 1
    return done


def outbox_status() -> dict:
    """For /health: how much is waiting and how much has given up."""
    with cursor() as cur:
        cur.execute("SELECT status, COUNT(*) AS n FROM webhook_outbox GROUP BY status")
        counts = {r["status"]: r["n"] for r in cur.fetchall()}
        cur.execute("SELECT MIN(created_at) AS oldest FROM webhook_outbox WHERE status = 'pending'")
        oldest = cur.fetchone()["oldest"]
    return {"pending": counts.get("pending", 0) + counts.get("sending", 0),
            "failed": counts.get("failed", 0), "oldest_pending": oldest}


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
