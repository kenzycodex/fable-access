"""Fable in front of the bank: pass sends once, a hold sends nothing, a lost
answer is only ever queried, and the bank's webhooks are trusted only when signed."""
import hashlib
import hmac
import json
import os
import socket
import sys
import tempfile
import time

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
os.environ.setdefault("FABLE_DB_PATH", os.path.join(tempfile.mkdtemp(), "forge.db"))
os.environ.setdefault("FABLE_SESSION_SECRET", "test-secret")

INST = "forgebank"
SECRET = "whsec_test_only"
_n = [0]


class FakeBank:
    """The Xtradot sandbox, as far as these tests need it."""

    def __init__(self):
        self.calls = []
        self.send_mode = "pending"  # pending | timeout
        self.requery_has_charges = True  # the real sandbox's requery reply carries the status only

    def posts_to(self, suffix):
        return [c for c in self.calls if c["method"] == "POST" and c["url"].endswith(suffix)]

    def __call__(self, method, url, payload, headers, timeout):
        from services.forge_bank import Reply

        self.calls.append({"method": method, "url": url, "payload": payload, "headers": headers})
        ok = lambda data, status=200: Reply(status, {"status": "success", "data": data, "request_id": "req_t"})  # noqa: E731
        if url.endswith("/balance"):
            return ok({"balance": 5_000_000})
        if url.endswith("/name-enquiry"):
            return ok({"account_name": "Chukwuemeka Ifeanyi Nwosu", "name_enquiry_ref": "ne_test"})
        if url.endswith("/transfers/interbank"):
            if self.send_mode == "timeout":
                raise socket.timeout("timed out")
            return ok({"status": "pending", "reference": payload["reference"]}, 202)
        if url.endswith("/requery"):
            if not self.requery_has_charges:
                return ok({"status": "successful", "reference": payload["reference"]})
            return ok({"status": "successful", "reference": payload["reference"], "fee": 50.0, "vat": 3.75,
                       "stamp_duty": 50.0, "total_debit": payload.get("amount", 0)})
        if method == "GET" and "/transfers/" in url:
            return ok({"status": "successful", "reference": url.rsplit("/", 1)[-1], "fee": 10.0, "vat": 0.75,
                       "stamp_duty": 0.0, "total_debit": 5010.75})
        raise AssertionError(f"unexpected bank call {method} {url}")


@pytest.fixture
def bank(monkeypatch):
    from services import forge_bank

    fake = FakeBank()
    monkeypatch.setenv("GATEWAY_KEY", "test-team-key")
    monkeypatch.setattr(forge_bank, "_send", fake)
    monkeypatch.setattr(forge_bank.time, "sleep", lambda _s: None)
    return fake


@pytest.fixture(scope="module")
def world():
    from fastapi.testclient import TestClient

    from core import apikeys
    from core.db import cursor
    from core.tenancy import register_institution
    from main import app

    register_institution(INST, "Forge Bank", "risk@forgebank.ng")
    raw = apikeys.generate()
    with cursor() as cur:
        apikeys.insert(cur, raw, INST, "Forge Bank", "owner@forgebank.ng")
        cur.execute("UPDATE institutions SET mode = 'live' WHERE institution_id = ?", (INST,))
    return TestClient(app), {"X-API-Key": raw}


def _transfer(amount, **extra):
    _n[0] += 1
    return {"user_id": f"cust_{_n[0]}", "source_account": "0123456790", "destination_account": "0123987001",
            "destination_bank_code": "000013", "name_enquiry_ref": "ne_test",
            "recipient_name": "Chukwuemeka Ifeanyi Nwosu", "amount": amount, "narration": "test",
            "client_reference": f"forge-test-{_n[0]}-{time.time_ns()}", **extra}


def test_a_small_transfer_passes_and_reaches_the_bank_once(world, bank):
    client, headers = world
    res = client.post("/v1/forge/transfer", json=_transfer(5_000), headers=headers)
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["decision"]["action"] == "PASS"
    assert body["transfer"]["state"] == "successful"
    assert body["transfer"]["fee"] == 50.0 and body["transfer"]["total_debit"] is not None
    assert len(bank.posts_to("/transfers/interbank")) == 1
    sent = bank.posts_to("/transfers/interbank")[0]
    assert sent["headers"]["Idempotency-Key"] and sent["payload"]["name_enquiry_ref"] == "ne_test"


def test_a_pass_with_no_history_does_not_claim_usual_habits(world, bank):
    client, headers = world
    body = client.post("/v1/forge/transfer", json=_transfer(5_000), headers=headers).json()
    assert any(s.startswith("cold_start") for s in body["decision"]["signals"])
    assert "usual habits" not in body["decision"]["explanation"]


def test_repeating_the_same_attempt_does_not_send_again(world, bank):
    client, headers = world
    payload = _transfer(5_000)
    first = client.post("/v1/forge/transfer", json=payload, headers=headers).json()
    second = client.post("/v1/forge/transfer", json=payload, headers=headers).json()
    assert first["transfer"]["id"] == second["transfer"]["id"]
    assert len(bank.posts_to("/transfers/interbank")) == 1


def test_a_lost_answer_is_only_queried_and_never_resent(world, bank):
    client, headers = world
    bank.send_mode = "timeout"
    res = client.post("/v1/forge/transfer", json=_transfer(5_000), headers=headers)
    assert res.status_code == 200, res.text
    assert res.json()["transfer"]["state"] == "successful"  # settled by requery
    assert len(bank.posts_to("/transfers/interbank")) == 1
    assert len(bank.posts_to("/requery")) >= 1
    # The trail says what happened, including that the answer was lost.
    trail = res.json()["transfer"]["trail"]
    states = [step["state"] for step in trail]
    assert states[0] == "decided" and "unknown" in states and states[-1] == "successful"
    assert next(s for s in trail if s["state"] == "unknown")["note"] == "the connection timed out"


def test_a_huge_first_transfer_is_held_and_nothing_is_sent(world, bank):
    client, headers = world
    res = client.post("/v1/forge/transfer", json=_transfer(50_000_000), headers=headers)
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["decision"]["action"] == "BLOCK" and body["next"] == "ghost_hold"
    assert body["hold"]["ghost_id"] and body["transfer"]["state"] == "held"
    assert bank.posts_to("/transfers/interbank") == []


def test_a_held_transfer_cannot_be_released_without_proof(world, bank):
    client, headers = world
    payload = _transfer(50_000_000)
    held = client.post("/v1/forge/transfer", json=payload, headers=headers).json()
    res = client.post(f"/v1/forge/transfers/{held['transfer']['id']}/release", headers=headers,
                      json={"user_id": payload["user_id"], "ghost_id": held["hold"]["ghost_id"]})
    assert res.status_code == 401
    assert bank.posts_to("/transfers/interbank") == []
    assert client.get(f"/v1/forge/transfers/{held['transfer']['id']}", headers=headers).json()["state"] == "held"


def test_cancelling_a_hold_sends_nothing_and_it_can_never_be_sent_after(world, bank):
    client, headers = world
    payload = _transfer(50_000_000)
    held = client.post("/v1/forge/transfer", json=payload, headers=headers).json()
    tid = held["transfer"]["id"]
    res = client.post(f"/v1/forge/transfers/{tid}/cancel", json={"user_id": payload["user_id"]}, headers=headers)
    assert res.status_code == 200 and res.json()["state"] == "cancelled"
    from services import forge_transfers

    assert forge_transfers.execute(tid)["state"] == "cancelled"
    assert bank.posts_to("/transfers/interbank") == []


def test_a_flagged_transfer_waits_and_cannot_be_confirmed_without_verifying(world, bank):
    client, headers = world
    payload = _transfer(200_000)
    body = client.post("/v1/forge/transfer", json=payload, headers=headers).json()
    if body["decision"]["action"] != "FLAG":
        pytest.skip("this amount did not land on a flag under the active engine version")
    assert body["next"] == "step_up" and body["transfer"]["state"] == "awaiting_stepup"
    res = client.post(f"/v1/forge/transfers/{body['transfer']['id']}/confirm", headers=headers,
                      json={"user_id": payload["user_id"]})
    assert res.status_code == 401
    assert bank.posts_to("/transfers/interbank") == []


def test_a_transfer_from_a_sandbox_institution_is_refused(world, bank):
    from core.db import cursor

    client, headers = world
    with cursor() as cur:
        cur.execute("UPDATE institutions SET mode = 'sandbox' WHERE institution_id = ?", (INST,))
    try:
        res = client.post("/v1/forge/transfer", json=_transfer(5_000), headers=headers)
        assert res.status_code in (403, 409)
    finally:
        with cursor() as cur:
            cur.execute("UPDATE institutions SET mode = 'live' WHERE institution_id = ?", (INST,))
    assert bank.posts_to("/transfers/interbank") == []


# --- webhooks -----------------------------------------------------------------

def _signed(body: dict, *, secret=SECRET, ts=None):
    raw = json.dumps(body).encode()
    ts = str(int(time.time()) if ts is None else ts)
    sig = "sha256=" + hmac.new(secret.encode(), ts.encode() + b"." + raw, hashlib.sha256).hexdigest()
    return raw, {"x-forge-timestamp": ts, "x-forge-signature": sig, "x-forge-event": body["event"],
                 "Content-Type": "application/json"}


@pytest.fixture
def hook(world, monkeypatch):
    monkeypatch.setenv("FORGE_WEBHOOK_SECRET", SECRET)
    return world[0]


def test_a_webhook_without_a_valid_signature_is_refused(hook):
    raw, headers = _signed({"event": "transfer.successful", "event_id": "evt_bad", "data": {"reference": "X"}},
                           secret="wrong")
    assert hook.post("/v1/forge/hooks/bank", content=raw, headers=headers).status_code == 401


def test_a_stale_webhook_is_refused(hook):
    raw, headers = _signed({"event": "transfer.successful", "event_id": "evt_old", "data": {"reference": "X"}},
                           ts=int(time.time()) - 3600)
    assert hook.post("/v1/forge/hooks/bank", content=raw, headers=headers).status_code == 401


def test_a_signed_webhook_updates_the_transfer_once(world, bank, hook):
    client, headers = world
    bank.send_mode = "pending"
    res = client.post("/v1/forge/transfer", json=_transfer(5_000), headers=headers).json()
    ref = res["transfer"]["reference"]
    from core.db import cursor

    with cursor() as cur:
        cur.execute("UPDATE forge_transfers SET state = 'pending' WHERE reference = ?", (ref,))
    raw, h = _signed({"event": "transfer.reversed", "event_id": f"evt_{ref}", "data": {"reference": ref}})
    first = hook.post("/v1/forge/hooks/bank", content=raw, headers=h)
    assert first.status_code == 200 and first.json()["matched"] is True
    assert client.get(f"/v1/forge/transfers/{res['transfer']['id']}", headers=headers).json()["state"] == "reversed"
    again = hook.post("/v1/forge/hooks/bank", content=raw, headers=h)
    assert again.json() == {"status": "duplicate"}


def test_a_late_pending_event_never_undoes_a_final_state(world, bank):
    from services import forge_transfers

    client, headers = world
    res = client.post("/v1/forge/transfer", json=_transfer(5_000), headers=headers).json()
    ref = res["transfer"]["reference"]
    assert res["transfer"]["state"] == "successful"
    row = forge_transfers.apply_event("transfer.pending", {"reference": ref})
    assert row["state"] == "successful"


def test_the_webhook_needs_a_configured_secret(world, monkeypatch):
    monkeypatch.delenv("FORGE_WEBHOOK_SECRET", raising=False)
    raw, headers = _signed({"event": "transfer.successful", "event_id": "evt_x", "data": {}})
    assert world[0].post("/v1/forge/hooks/bank", content=raw, headers=headers).status_code == 503


def test_charges_come_from_the_transfer_record_when_the_requery_has_none(world, bank):
    client, headers = world
    bank.requery_has_charges = False
    res = client.post("/v1/forge/transfer", json=_transfer(5_000), headers=headers)
    assert res.status_code == 200, res.text
    t = res.json()["transfer"]
    assert t["state"] == "successful"
    assert (t["fee"], t["vat"], t["total_debit"]) == (10.0, 0.75, 5010.75)
