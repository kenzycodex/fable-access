"""Client for the Xtradot Bank sandbox on the Forge cluster.

Two rules shape everything here:

1. A transfer is sent once. If the answer is lost (the call times out, or the
   bank replies 504 TIMEOUT), the outcome is unknown, so the caller must ask
   for the status by reference and must never send again: resending is how a
   customer gets debited twice. `send_transfer` therefore never retries, and
   raises `OutcomeUnknown` carrying the reference to look up.
2. Charges are read from the bank's response. Nothing here knows a fee.

The team key comes from the environment (GATEWAY_KEY, injected from the
cluster's secret) and is never logged or put in an error message.
"""
import json
import logging
import os
import socket
import time
import urllib.error
import urllib.request
import uuid
from dataclasses import dataclass, field

logger = logging.getLogger("fable.bank")

BASE_URL = os.getenv("FORGE_BANK_BASE_URL", "http://bank-api.ingress-apisix.svc.cluster.local/v1").rstrip("/")
# The gateway gives the sandbox 30 s; a little more here so its 504 arrives
# as a reply rather than as our own socket timeout.
TIMEOUT_SECONDS = float(os.getenv("FORGE_BANK_TIMEOUT_SECONDS", "35"))
# Final states of a transfer. Anything else means "ask again".
FINAL_STATES = {"successful", "failed", "reversed"}


class BankError(Exception):
    """The bank answered with an error envelope."""

    def __init__(self, status: int, code: str, message: str, field_name: str | None = None,
                 request_id: str | None = None):
        super().__init__(f"{code}: {message}")
        self.status = status
        self.code = code
        self.message = message
        self.field = field_name
        self.request_id = request_id


class OutcomeUnknown(Exception):
    """The transfer may or may not have happened. Query it; never resend."""

    def __init__(self, reference: str, reason: str):
        super().__init__(f"Outcome of {reference} is unknown ({reason}). Query it; do not resend.")
        self.reference = reference
        self.reason = reason


@dataclass
class Reply:
    status: int
    body: dict
    headers: dict = field(default_factory=dict)

    @property
    def data(self) -> dict:
        return self.body.get("data") or {}


def _key() -> str:
    key = os.getenv("GATEWAY_KEY", "").strip()
    if not key:
        raise BankError(0, "NOT_CONFIGURED", "GATEWAY_KEY is not set, so the bank cannot be called.")
    return key


def _send(method: str, url: str, payload: dict | None, headers: dict, timeout: float) -> Reply:
    """The one place that touches the network, so tests replace only this."""
    data = json.dumps(payload).encode() if payload is not None else None
    req = urllib.request.Request(url, data=data, method=method, headers=headers)
    try:
        with urllib.request.urlopen(req, timeout=timeout) as res:  # noqa: S310 - fixed internal base URL
            raw = res.read()
            return Reply(res.status, json.loads(raw) if raw else {}, dict(res.headers))
    except urllib.error.HTTPError as exc:
        raw = exc.read()
        try:
            body = json.loads(raw) if raw else {}
        except ValueError:
            body = {"status": "error", "error": {"code": "UNPARSEABLE", "message": raw[:200].decode("utf-8", "replace")}}
        return Reply(exc.code, body, dict(exc.headers or {}))


def _call(method: str, path: str, payload: dict | None = None, *, idempotency_key: str | None = None,
          extra_headers: dict | None = None) -> Reply:
    headers = {"x-api-key": _key(), "Accept": "application/json", "x-request-id": f"fable_{uuid.uuid4().hex[:12]}"}
    if payload is not None:
        headers["Content-Type"] = "application/json"
    if idempotency_key:
        headers["Idempotency-Key"] = idempotency_key
    if extra_headers:
        headers.update(extra_headers)
    reply = _send(method, f"{BASE_URL}{path}", payload, headers, TIMEOUT_SECONDS)
    if reply.body.get("status") == "error" or reply.status >= 400:
        err = reply.body.get("error") or {}
        raise BankError(reply.status, err.get("code") or f"HTTP_{reply.status}", err.get("message") or "The bank refused the request.",
                        err.get("field"), reply.body.get("request_id"))
    return reply


def _get_with_backoff(path: str, attempts: int = 4) -> Reply:
    """Reads are safe to repeat, so a 429 waits for Retry-After and tries again."""
    for attempt in range(attempts):
        try:
            return _call("GET", path)
        except BankError as exc:
            if exc.code != "RATE_LIMITED" or attempt == attempts - 1:
                raise
            time.sleep(min(5.0, 1.0 + attempt))
    raise AssertionError("unreachable")


# --- Reference data and accounts --------------------------------------------

def tariff() -> dict:
    return _get_with_backoff("/tariff").data


def banks() -> list:
    data = _get_with_backoff("/banks").data
    return data.get("banks", data) if isinstance(data, dict) else data


def balance(account_number: str) -> dict:
    return _get_with_backoff(f"/accounts/{account_number}/balance").data


# --- Name enquiry ------------------------------------------------------------

def name_enquiry(account_number: str, bank_code: str | None = None, *, intra: bool = False) -> dict:
    """Resolve the beneficiary. The caller must show `account_name` to the customer.

    The returned `name_enquiry_ref` is single use and expires after 10 minutes.
    """
    if intra:
        reply = _call("POST", "/transfers/intra/name-enquiry", {"account_number": account_number})
    else:
        if not bank_code:
            raise BankError(400, "INVALID_REQUEST", "destination_bank_code is required for an interbank transfer.", "destination_bank_code")
        reply = _call("POST", "/transfers/interbank/name-enquiry",
                      {"destination_bank_code": bank_code, "account_number": account_number})
    return reply.data


# --- Transfers ---------------------------------------------------------------

def new_reference(prefix: str = "FBL") -> str:
    return f"{prefix}-{uuid.uuid4().hex[:16].upper()}"


def send_transfer(*, source_account: str, destination_account: str, name_enquiry_ref: str, amount: float,
                  narration: str, reference: str, destination_bank_code: str | None = None,
                  intra: bool = False, idempotency_key: str | None = None) -> dict:
    """Send once. Never retried: on any doubt it raises OutcomeUnknown.

    The idempotency key is derived from the reference, so even a repeated call
    from a restarted process is replayed by the bank and not re-debited.
    """
    body = {"source_account": source_account, "destination_account": destination_account,
            "name_enquiry_ref": name_enquiry_ref, "amount": round(float(amount), 2),
            "narration": narration, "reference": reference}
    path = "/transfers/intra"
    if not intra:
        if not destination_bank_code:
            raise BankError(400, "INVALID_REQUEST", "destination_bank_code is required for an interbank transfer.", "destination_bank_code")
        body["destination_bank_code"] = destination_bank_code
        path = "/transfers/interbank"
    key = idempotency_key or str(uuid.uuid5(uuid.NAMESPACE_URL, f"fable-transfer:{reference}"))
    try:
        return _call("POST", path, body, idempotency_key=key).data
    except (socket.timeout, TimeoutError) as exc:
        raise OutcomeUnknown(reference, "the connection timed out") from exc
    except urllib.error.URLError as exc:
        if isinstance(getattr(exc, "reason", None), (socket.timeout, TimeoutError)):
            raise OutcomeUnknown(reference, "the connection timed out") from exc
        raise
    except BankError as exc:
        if exc.code == "TIMEOUT" or exc.status == 504:
            raise OutcomeUnknown(reference, "the bank reported TIMEOUT") from exc
        raise


def transfer_status(reference: str) -> dict:
    return _get_with_backoff(f"/transfers/{reference}").data


def requery(reference: str) -> dict:
    """Ask the interbank switch (TSQ) for the final state of a transfer."""
    return _call("POST", "/transfers/interbank/requery", {"reference": reference}).data


def settle(reference: str, *, attempts: int = 12, wait_seconds: float = 5.0, interbank: bool = True) -> dict:
    """Poll until the transfer is final. Never sends anything.

    Returns the last status seen; if it is still not final after `attempts`
    polls, the caller keeps the transfer as pending and a webhook or a later
    poll completes it.
    """
    last: dict = {}
    for attempt in range(attempts):
        try:
            last = requery(reference) if interbank else transfer_status(reference)
        except BankError as exc:
            if exc.code == "NOT_FOUND" and attempt < attempts - 1:
                time.sleep(wait_seconds)
                continue
            raise
        if str(last.get("status", "")).lower() in FINAL_STATES:
            return last
        time.sleep(wait_seconds)
    return last
