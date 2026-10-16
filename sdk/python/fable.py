"""Fable reference client for Python 3.9+.

Standard library only. Copy this file into your service.

    from fable import Fable, verify_webhook

    fable = Fable(base_url=os.environ["FABLE_API_URL"], api_key=os.environ["FABLE_API_KEY"])
    verdict = fable.analyze("cust_10293", amount=250000, recipient_account="0111222333")
    if verdict["action"] == "PASS":
        ...

Server-side only. The API key must never reach a browser or a mobile app.
"""
from __future__ import annotations

import hashlib
import hmac
import json
import time
import urllib.error
import urllib.parse
import urllib.request
from typing import Any, Optional


class FableError(Exception):
    def __init__(self, message: str, status: int, body: Any = None):
        super().__init__(message)
        self.status = status
        self.body = body


class Fable:
    def __init__(self, base_url: str, api_key: str, timeout: float = 1.5):
        if not api_key:
            raise ValueError("Fable: an API key is required.")
        self.base_url = base_url.rstrip("/")
        self.api_key = api_key
        # Scoring targets well under 200ms; the timeout leaves room for the
        # network. Decide what a timeout means for you (treat it as a FLAG).
        self.timeout = timeout

    def _request(self, method: str, path: str, body: Optional[dict] = None) -> Any:
        data = None if body is None else json.dumps({k: v for k, v in body.items() if v is not None}).encode()
        req = urllib.request.Request(
            self.base_url + path,
            data=data,
            method=method,
            headers={"Content-Type": "application/json", "X-API-Key": self.api_key},
        )
        try:
            with urllib.request.urlopen(req, timeout=self.timeout) as resp:
                raw = resp.read()
                return json.loads(raw) if raw else None
        except urllib.error.HTTPError as exc:
            raw = exc.read()
            try:
                parsed = json.loads(raw) if raw else None
            except ValueError:
                parsed = None
            detail = (parsed or {}).get("detail") if isinstance(parsed, dict) else None
            message = detail if isinstance(detail, str) else (detail or {}).get("message", f"Fable API returned {exc.code}") if isinstance(detail, dict) else f"Fable API returned {exc.code}"
            raise FableError(message, exc.code, parsed) from None

    def analyze(
        self,
        user_id: str,
        *,
        amount: float,
        recipient_account: str,
        recipient_bank_code: Optional[str] = None,
        recipient_name: Optional[str] = None,
        narration: Optional[str] = None,
        channel: str = "mobile_app",
        client_reference: Optional[str] = None,
        device: Optional[dict] = None,
        context: Optional[dict] = None,
    ) -> dict:
        """Score a transfer before money moves."""
        return self._request("POST", "/v1/shield/analyze", {
            "user_id": user_id,
            "client_reference": client_reference,
            "device": device,
            "context": context,
            "transaction": {
                k: v for k, v in {
                    "amount": amount,
                    "currency": "NGN",
                    "recipient_account": recipient_account,
                    "recipient_bank_code": recipient_bank_code,
                    "recipient_name": recipient_name,
                    "narration": narration,
                    "channel": channel,
                }.items() if v is not None
            },
        })

    def analyze_or_flag(self, user_id: str, **kwargs) -> dict:
        """Score a transfer, treating a timeout or outage as a FLAG, never a PASS."""
        try:
            return self.analyze(user_id, **kwargs)
        except FableError as exc:
            if exc.status < 500:
                raise  # the request itself was wrong; fix it
            return {"action": "FLAG", "unavailable": True}
        except (urllib.error.URLError, TimeoutError, OSError):
            return {"action": "FLAG", "unavailable": True}

    def feedback(self, user_id: str, transaction_id: str, was_fraud: bool) -> dict:
        """Report how a decision turned out."""
        return self._request("POST", "/v1/shield/feedback", {
            "user_id": user_id, "transaction_id": transaction_id, "was_fraud": was_fraud,
        })

    def step_up_requirement(self, user_id: str, verdict: dict) -> dict:
        """Which factor a flagged transfer needs, from Fable's stored decision."""
        return self._request("POST", "/v1/stepup/requirement", {
            "user_id": user_id,
            "purpose": "transfer",
            "reference": verdict["transaction_id"],
        })

    def approve(self, transaction_id: str, user_id: str, stepup_token: str) -> dict:
        return self._request("POST", f"/v1/transactions/{urllib.parse.quote(transaction_id)}/approve", {
            "user_id": user_id, "stepup_token": stepup_token,
        })

    def hold(self, user_id: str, transaction_id: str) -> dict:
        """Hold a blocked transfer the customer insists on, so the money stays
        recoverable. Keep the funds until a containment.released, .cancelled
        or .expired webhook says what to do with them."""
        return self._request("POST", "/v1/ghost/create", {"user_id": user_id, "transaction_id": transaction_id})

    def request_release(self, ghost_id: str, user_id: str) -> dict:
        """The customer cannot produce the proof a release needs and asks the bank instead."""
        return self._request("POST", f"/v1/ghost/{urllib.parse.quote(ghost_id)}/request-release",
                             {"user_id": user_id})

    def cancel_hold(self, ghost_id: str, user_id: str) -> dict:
        return self._request("POST", f"/v1/ghost/{urllib.parse.quote(ghost_id)}/cancel", {"user_id": user_id})

    def release_hold(self, ghost_id: str, user_id: str, stepup_token: str) -> dict:
        return self._request("POST", f"/v1/ghost/{urllib.parse.quote(ghost_id)}/confirm", {
            "user_id": user_id, "stepup_token": stepup_token,
        })


def verify_webhook(raw_body: bytes, signature_header: Optional[str], secret: str,
                   tolerance: int = 300) -> Optional[dict]:
    """Return the event if the delivery is genuine and recent, else None.

    Pass the raw request body exactly as received, not re-serialised JSON.
    """
    if not signature_header:
        return None
    try:
        parts = dict(p.strip().split("=", 1) for p in signature_header.split(","))
        t = int(parts.get("t", "0"))
    except ValueError:
        return None
    if not t or abs(time.time() - t) > tolerance or not parts.get("v1"):
        return None
    expected = hmac.new(secret.encode(), f"{t}.".encode() + raw_body, hashlib.sha256).hexdigest()
    if not hmac.compare_digest(expected, parts["v1"]):
        return None
    return json.loads(raw_body)
