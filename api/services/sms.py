"""Sending SMS through a provider, or honestly not at all.

A provider is chosen with the SMS_PROVIDER setting (environment or operator
console) and its credentials come from managed settings. With no provider,
`configured()` is false: codes and alerts go by email (or, for a sandbox bank,
to the sandbox inbox) and nothing ever claims an SMS was sent.

Termii and Africa's Talking (including its free sandbox) are built in. Adding
another (Twilio) is one class with `ready` and `send`, registered in PROVIDERS.
"""
from __future__ import annotations

import json
import logging
import urllib.error
import urllib.parse
import urllib.request
from dataclasses import dataclass

from core import integrations

logger = logging.getLogger("fable.sms")
TIMEOUT_SECONDS = 10


@dataclass
class SmsResult:
    sent: bool
    detail: str = ""


def normalise_ng(number: str) -> str | None:
    """A Nigerian number in international form without the plus (2348031234567),
    or None when it is not one. Other countries pass through as digits."""
    digits = "".join(c for c in (number or "") if c.isdigit())
    if digits.startswith("0") and len(digits) == 11:
        return "234" + digits[1:]
    if digits.startswith("234") and len(digits) == 13:
        return digits
    if 10 <= len(digits) <= 15:
        return digits
    return None


class TermiiProvider:
    name = "termii"

    def __init__(self, settings: dict):
        self.key = settings.get("termii_api_key") or ""
        self.sender = settings.get("sender_id") or "Fable"
        self.base = (settings.get("termii_base_url") or "https://api.ng.termii.com").rstrip("/")

    def ready(self) -> bool:
        return bool(self.key)

    def send(self, to: str, text: str) -> SmsResult:
        body = json.dumps({
            "to": to, "from": self.sender, "sms": text, "type": "plain",
            "channel": "dnd", "api_key": self.key,
        }).encode()
        req = urllib.request.Request(f"{self.base}/api/sms/send", data=body, method="POST",
                                     headers={"Content-Type": "application/json"})
        try:
            with urllib.request.urlopen(req, timeout=TIMEOUT_SECONDS) as resp:  # noqa: S310 - fixed provider URL
                payload = json.loads(resp.read(4096).decode("utf-8", "ignore") or "{}")
                ok = 200 <= resp.status < 300 and bool(payload.get("message_id"))
                return SmsResult(ok, "accepted" if ok else "not accepted")
        except urllib.error.HTTPError as exc:
            return SmsResult(False, f"HTTP {exc.code}")
        except Exception as exc:  # noqa: BLE001 - never echo provider text, which can hold the key
            return SmsResult(False, type(exc).__name__)


class AfricasTalkingProvider:
    """Africa's Talking SMS. Works with the free sandbox (username "sandbox",
    sandbox base URL; messages land in their simulator) and with a live app."""

    name = "africastalking"

    def __init__(self, settings: dict):
        from core import config

        self.key = settings.get("africastalking_api_key") or ""
        self.username = settings.get("africastalking_username") or "sandbox"
        env = settings.get("africastalking_env") or "sandbox"
        self.base = config.AFRICASTALKING_URLS.get(env, config.AFRICASTALKING_URLS["sandbox"])
        self.sender = settings.get("sender_id") or ""
        self.sandbox = env != "live"

    def ready(self) -> bool:
        return bool(self.key and self.username)

    def send(self, to: str, text: str) -> SmsResult:
        fields = {"username": self.username, "to": f"+{to}", "message": text}
        # A sender ID must be registered with Africa's Talking for live use;
        # the sandbox ignores it, so it is only sent live.
        if self.sender and not self.sandbox:
            fields["from"] = self.sender
        req = urllib.request.Request(
            f"{self.base}/version1/messaging", data=urllib.parse.urlencode(fields).encode(), method="POST",
            headers={"apiKey": self.key, "Accept": "application/json",
                     "Content-Type": "application/x-www-form-urlencoded"},
        )
        try:
            with urllib.request.urlopen(req, timeout=TIMEOUT_SECONDS) as resp:  # noqa: S310 - fixed provider URL
                payload = json.loads(resp.read(8192).decode("utf-8", "ignore") or "{}")
            recipients = (payload.get("SMSMessageData") or {}).get("Recipients") or []
            # 100 Processed, 101 Sent, 102 Queued: accepted for delivery.
            ok = any(int(r.get("statusCode", 0)) in (100, 101, 102) for r in recipients)
            return SmsResult(ok, "accepted" if ok else (recipients[0].get("status") if recipients else "not accepted"))
        except urllib.error.HTTPError as exc:
            return SmsResult(False, f"HTTP {exc.code}")
        except Exception as exc:  # noqa: BLE001 - never echo provider text, which can hold the key
            return SmsResult(False, type(exc).__name__)


PROVIDERS = {"termii": TermiiProvider, "africastalking": AfricasTalkingProvider}


def _provider():
    settings = integrations.sms()
    cls = PROVIDERS.get(settings["provider"])
    if not cls:
        return None
    provider = cls(settings)
    return provider if provider.ready() else None


def describe() -> str:
    """Which provider is in force, for the console ("Africa's Talking (sandbox)")."""
    provider = _provider()
    if provider is None:
        return "none"
    if isinstance(provider, AfricasTalkingProvider):
        return "Africa's Talking (sandbox)" if provider.sandbox else "Africa's Talking"
    return "Termii"


def configured() -> bool:
    """Whether an SMS provider is set up with credentials."""
    try:
        return _provider() is not None
    except Exception:  # noqa: BLE001
        return False


def send(number: str, text: str) -> SmsResult:
    provider = _provider()
    if provider is None:
        return SmsResult(False, "no provider")
    to = normalise_ng(number)
    if not to:
        return SmsResult(False, "invalid number")
    result = provider.send(to, text)
    if not result.sent:
        logger.warning("SMS to ***%s failed: %s", to[-4:], result.detail)
    return result
