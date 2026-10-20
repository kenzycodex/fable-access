"""Codes and notices reach customers on their own channels, honestly.

  * A sandbox bank's codes land in the sandbox inbox, so testing never depends
    on a real email; a live bank's never do, and its inbox endpoint is refused.
  * A live bank's undeliverable code is a failed factor (502), never returned.
  * A phone is confirmed like an email: pending until its code is entered.
  * SMS goes through a provider (Termii) when one is configured; otherwise it is
    unavailable and nothing claims an SMS was sent.
  * Mail settings can come from the operator console.
"""
import json
import os
import secrets
import sys
import tempfile

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
os.environ.setdefault("FABLE_DB_PATH", os.path.join(tempfile.mkdtemp(), "delivery.db"))
os.environ.setdefault("FABLE_SESSION_SECRET", "test-secret")

SANDBOX, LIVE = "deliverysandbox", "deliverylive"


def _session(inst: str) -> dict:
    from core import sessions

    return {"X-Fable-Session": sessions.issue(f"owner@{inst}.ng", inst)["token"]}


@pytest.fixture(scope="module")
def world():
    from fastapi.testclient import TestClient

    from core import apikeys
    from core.db import cursor
    from core.tenancy import register_institution
    from main import app

    register_institution(SANDBOX, "Delivery Sandbox", "risk@sandbox.ng")
    register_institution(LIVE, "Delivery Live", "risk@live.ng")
    raw = apikeys.generate()
    with cursor() as cur:
        apikeys.insert(cur, raw, LIVE, "Delivery Live", "owner@live.ng")
        cur.execute("UPDATE institutions SET mode = 'live' WHERE institution_id = ?", (LIVE,))
    return {"client": TestClient(app), "live_key": {"X-API-Key": raw}}


def _customer(inst: str, ref: str) -> str:
    from core import customers

    return customers.ensure(inst, ref, kind="test" if inst == SANDBOX else "real", source="console")["id"]


def _decision(user_id: str, inst: str) -> str:
    from core.db import cursor

    txid = f"txn_{secrets.token_hex(6)}"
    with cursor() as cur:
        cur.execute("INSERT INTO transactions (id, user_id, amount, institution_id, action_taken, risk_score, "
                    "shield_signals) VALUES (?, ?, 5000, ?, 'FLAG', 0.6, '[]')", (txid, user_id, inst))
    return txid


def _email(user_id: str, address: str, inst: str) -> None:
    from core.db import cursor

    with cursor() as cur:
        cur.execute("INSERT INTO user_security (user_id, institution_id, contact_email) VALUES (?, ?, ?) "
                    "ON CONFLICT(user_id) DO UPDATE SET contact_email = excluded.contact_email",
                    (user_id, inst, address))


def test_a_sandbox_code_lands_in_the_sandbox_inbox(world):
    c = world["client"]
    user = _customer(SANDBOX, "inbox-1")
    _email(user, "tester@example.ng", SANDBOX)
    res = c.post("/v1/stepup/otp/send", headers=_session(SANDBOX), json={
        "user_id": user, "purpose": "transfer", "reference": _decision(user, SANDBOX)})
    assert res.status_code == 200, res.text
    assert res.json()["sandbox_inbox"] is True and "debug_code" not in res.json()
    items = c.get(f"/v1/sandbox/inbox/{user}", headers=_session(SANDBOX)).json()["items"]
    code = items[0]["code"]
    assert items[0]["kind"] == "code" and len(code) == 6
    ok = c.post("/v1/stepup/otp/verify", headers=_session(SANDBOX), json={
        "user_id": user, "challenge_id": res.json()["challenge_id"], "code": code})
    assert ok.status_code == 200 and ok.json()["level"] == "otp"


def test_a_live_bank_never_gets_an_inbox_and_an_undelivered_code_fails(world):
    from core.db import cursor

    c = world["client"]
    user = _customer(LIVE, "live-1")
    _email(user, "real-customer@example.ng", LIVE)
    headers = {**world["live_key"]}
    res = c.post("/v1/stepup/otp/send", headers=headers, json={
        "user_id": user, "purpose": "transfer", "reference": _decision(user, LIVE)})
    assert res.status_code == 502  # no mail server in tests: a failed factor, not a returned code
    assert "debug_code" not in res.text
    with cursor() as cur:
        cur.execute("SELECT COUNT(*) AS n FROM sandbox_inbox WHERE user_id = ?", (user,))
        assert cur.fetchone()["n"] == 0
    assert c.get(f"/v1/sandbox/inbox/{user}", headers=headers).status_code == 409


def test_a_phone_is_confirmed_like_an_email(world):
    from core import security

    c = world["client"]
    user = _customer(SANDBOX, "phone-1")
    started = c.post(f"/v1/accounts/{user}/security/contact", headers=_session(SANDBOX),
                     json={"phone": "08031234567"})
    assert started.status_code == 200, started.text
    body = started.json()
    assert body["pending_phone"] and body["phone_set"] is False
    v = body["verifications"][0]
    assert v["channel"] == "sms"
    assert security.get_contact(user)["phone"] is None   # not in force yet
    code = c.get(f"/v1/sandbox/inbox/{user}", headers=_session(SANDBOX)).json()["items"][0]["code"]
    done = c.post(f"/v1/accounts/{user}/security/contact/verify", headers=_session(SANDBOX),
                  json={"challenge_id": v["challenge_id"], "code": code})
    assert done.status_code == 200, done.text
    assert done.json()["phone_set"] is True
    assert security.get_contact(user)["phone"] == "08031234567"

    # A code by SMS can now be sent, and is one factor on its own.
    send = c.post("/v1/stepup/otp/send", headers=_session(SANDBOX), json={
        "user_id": user, "purpose": "transfer", "reference": _decision(user, SANDBOX), "channel": "sms"})
    assert send.status_code == 200 and send.json()["channel"] == "sms"


def test_a_live_bank_cannot_add_a_phone_without_an_sms_provider(world):
    c = world["client"]
    user = _customer(LIVE, "live-phone")
    res = c.post(f"/v1/accounts/{user}/security/contact", headers=world["live_key"], json={"phone": "08031234567"})
    assert res.status_code == 400 and "SMS" in res.json()["detail"]


def test_an_sms_code_alone_never_reaches_the_top_tier():
    from agents.shield.assurance import level_for_factors

    assert level_for_factors({"otp"}, has_passkey=True) == "otp"
    assert level_for_factors({"passkey", "pin", "otp"}, has_passkey=True) == "identity_check"


def test_a_liveness_factor_cannot_be_used_until_a_provider_exists():
    from agents.shield.assurance import FACTORS, level_for_factors

    assert FACTORS["liveness"]["status"] == "planned"
    assert level_for_factors({"liveness", "passkey"}, has_passkey=True) == "passkey"


def test_termii_sends_through_its_api(monkeypatch):
    from core import integrations
    from services import sms

    monkeypatch.setattr(integrations, "sms", lambda: {"provider": "termii", "termii_api_key": "TLtestkey",
                                                      "sender_id": "Fable", "termii_base_url": "https://termii.test"})
    calls = []

    class Resp:
        status = 200

        def read(self, n):
            return b'{"message_id": "m1"}'

        def __enter__(self):
            return self

        def __exit__(self, *a):
            return False

    def fake_urlopen(req, timeout):
        calls.append((req.full_url, json.loads(req.data)))
        return Resp()

    monkeypatch.setattr(sms.urllib.request, "urlopen", fake_urlopen)
    assert sms.configured() is True
    assert sms.send("0803 123 4567", "Your code is 123456").sent is True
    url, body = calls[0]
    assert url == "https://termii.test/api/sms/send"
    assert body["to"] == "2348031234567" and body["from"] == "Fable" and body["api_key"] == "TLtestkey"


def test_without_a_provider_sms_is_unavailable_and_never_claimed():
    from services import sms

    assert sms.configured() is False
    assert sms.send("08031234567", "x").sent is False


def test_mail_settings_can_come_from_the_console(monkeypatch):
    from core import integrations
    from core import secrets as vault
    from services import mailer

    values = {"SMTP_SERVER": "mail.example.ng", "SMTP_PORT": "2525", "SMTP_USERNAME": "fable",
              "SMTP_PASSWORD": "app pass word", "SMTP_FROM": "Fable <no-reply@example.ng>"}
    monkeypatch.setattr(vault, "get", lambda name: values.get(name, ""))
    s = integrations.smtp()
    assert s["server"] == "mail.example.ng" and s["port"] == 2525 and s["password"] == "app pass word"
    assert mailer.configured() is True


def test_text_settings_are_validated():
    from core import secrets as vault

    with pytest.raises(ValueError):
        vault.parse_setting(vault.MANAGED["FRONTEND_URL"], "not a url")
    with pytest.raises(ValueError):
        vault.parse_setting(vault.MANAGED["FABLE_CORS_ORIGINS"], "https://a.ng/path")
    with pytest.raises(ValueError):
        vault.parse_setting(vault.MANAGED["SMS_PROVIDER"], "carrier-pigeon")
    assert vault.parse_setting(vault.MANAGED["FABLE_CORS_ORIGINS"], "https://a.ng, https://b.ng") == \
        "https://a.ng, https://b.ng"


def test_africas_talking_sandbox_sends_through_its_api(monkeypatch):
    from core import integrations
    from services import sms

    monkeypatch.setattr(integrations, "sms", lambda: {
        "provider": "africastalking", "africastalking_api_key": "atsk_test", "africastalking_username": "sandbox",
        "africastalking_env": "sandbox", "sender_id": "Fable"})
    calls = []

    class Resp:
        def read(self, n):
            return b'{"SMSMessageData": {"Recipients": [{"statusCode": 101, "status": "Success"}]}}'

        def __enter__(self):
            return self

        def __exit__(self, *a):
            return False

    def fake_urlopen(req, timeout):
        calls.append((req.full_url, dict(req.header_items()), req.data.decode()))
        return Resp()

    monkeypatch.setattr(sms.urllib.request, "urlopen", fake_urlopen)
    assert sms.describe() == "Africa's Talking (sandbox)"
    assert sms.send("08031234567", "code 123456").sent is True
    url, headers, body = calls[0]
    assert url == "https://api.sandbox.africastalking.com/version1/messaging"
    assert headers.get("Apikey") == "atsk_test"
    assert "username=sandbox" in body and "to=%2B2348031234567" in body and "from=" not in body


def test_africas_talking_reports_a_refused_message(monkeypatch):
    from core import integrations
    from services import sms

    monkeypatch.setattr(integrations, "sms", lambda: {
        "provider": "africastalking", "africastalking_api_key": "k", "africastalking_username": "app",
        "africastalking_env": "live", "sender_id": "Fable"})

    class Resp:
        def read(self, n):
            return b'{"SMSMessageData": {"Recipients": [{"statusCode": 403, "status": "InvalidPhoneNumber"}]}}'

        def __enter__(self):
            return self

        def __exit__(self, *a):
            return False

    monkeypatch.setattr(sms.urllib.request, "urlopen", lambda req, timeout: Resp())
    result = sms.send("08031234567", "x")
    assert result.sent is False and result.detail == "InvalidPhoneNumber"
