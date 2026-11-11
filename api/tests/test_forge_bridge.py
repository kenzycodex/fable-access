"""The sandbox demo, connected to the Xtradot Bank sandbox: what the app does is
unchanged, and every transfer money moves on also reaches the bank, once."""
import os
import socket
import sys
import tempfile
import time

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
os.environ.setdefault("FABLE_DB_PATH", os.path.join(tempfile.mkdtemp(), "forge-bridge.db"))
os.environ.setdefault("FABLE_SESSION_SECRET", "test-secret")

BANK = "xtradot"
EMAIL = "team11@fable.ng"
_n = [0]


class FakeBank:
    def __init__(self):
        self.calls = []

    def sends(self):
        return [c for c in self.calls if c["method"] == "POST" and c["url"].rsplit("/", 1)[-1] in ("intra", "interbank")]

    def __call__(self, method, url, payload, headers, timeout):
        from services.forge_bank import Reply
        from services.forge_bridge import BENEFICIARIES

        self.calls.append({"method": method, "url": url, "payload": payload})
        ok = lambda data, status=200: Reply(status, {"status": "success", "data": data})  # noqa: E731
        if url.endswith("/name-enquiry"):
            acct = payload["account_number"]
            return ok({"account_name": BENEFICIARIES[acct][0], "name_enquiry_ref": f"ne_{acct}_{time.time_ns()}"})
        if url.endswith("/transfers/intra"):
            return ok({"status": "successful", "reference": payload["reference"], "fee": 0.0, "vat": 0.0,
                       "stamp_duty": 0.0, "total_debit": payload["amount"]}, 201)
        if url.endswith("/transfers/interbank"):
            if round(payload["amount"] * 100) % 100 == 2:
                raise socket.timeout("timed out")
            return ok({"status": "pending", "reference": payload["reference"]}, 202)
        if url.endswith("/requery"):
            return ok({"status": "successful", "reference": payload["reference"], "fee": 25.0, "vat": 1.88,
                       "stamp_duty": 0.0, "total_debit": 0.0})
        raise AssertionError(url)


@pytest.fixture
def bank(monkeypatch):
    from services import forge_bank

    fake = FakeBank()
    monkeypatch.setenv("GATEWAY_KEY", "test-team-key")
    monkeypatch.setenv("FORGE_BRIDGE_INSTITUTION", BANK)
    monkeypatch.setattr(forge_bank, "_send", fake)
    monkeypatch.setattr(forge_bank.time, "sleep", lambda _s: None)
    return fake


@pytest.fixture(scope="module")
def world():
    from fastapi.testclient import TestClient

    from core import sessions
    from main import app
    from services import forge_seed

    forge_seed.ensure_bank(BANK, EMAIL, "demo-password-123")
    return TestClient(app), {"X-Fable-Session": sessions.issue(EMAIL, BANK)["token"]}


def _settled(txid, timeout=5.0):
    from services import forge_transfers

    end = time.time() + timeout
    while time.time() < end:
        row = forge_transfers.get(txid)
        if row and row["state"] in ("successful", "failed", "reversed"):
            return row
        time.sleep(0.05)
    return forge_transfers.get(txid)


def _score(client, headers, customer, account, name, bank_name, code, amount):
    _n[0] += 1
    res = client.post("/v1/shield/analyze", headers=headers, json={
        "user_id": customer, "client_reference": f"bridge-{_n[0]}-{time.time_ns()}",
        "transaction": {"amount": amount, "recipient_account": account, "recipient_name": name,
                        "recipient_bank": bank_name, "recipient_bank_code": code, "channel": "mobile_app"}})
    assert res.status_code == 200, res.text
    return res.json()


def test_the_bank_is_set_up_like_a_real_onboarding(world):
    from core import customers
    from core.db import cursor

    with cursor() as cur:
        cur.execute("SELECT mode FROM institutions WHERE institution_id = ?", (BANK,))
        assert cur.fetchone()["mode"] == "sandbox"
        cur.execute("SELECT COUNT(*) AS n FROM transaction_history WHERE institution_id = ?", (BANK,))
        assert cur.fetchone()["n"] > 100
    assert customers.get(BANK, "0123456789")["kind"] == "test"


def test_a_routine_transfer_to_a_usual_payee_passes_on_habits_and_reaches_the_bank(world, bank):
    client, headers = world
    body = _score(client, headers, "0123456789", "0987654321", "Ngozi Adaobi Eze", "Xtradot Bank", "000014", 5_000)
    assert body["action"] == "PASS"
    assert not any(s.startswith("cold_start") for s in body["signals"])  # judged on her history
    row = _settled(body["transaction_id"])
    assert row["state"] == "successful" and row["source_account"] == "0123456789"
    assert len(bank.sends()) == 1 and bank.sends()[0]["url"].endswith("/transfers/intra")
    status = client.get(f"/v1/forge/transfers/{body['transaction_id']}", headers=headers,
                        params={"user_id": "0123456789"})
    assert status.status_code == 200 and status.json()["state"] == "successful"


def test_an_interbank_transfer_uses_the_bank_code_and_settles(world, bank):
    client, headers = world
    body = _score(client, headers, "0123456793", "0123987001", "Chukwuemeka Ifeanyi Nwosu", "GTBank", "000013", 150_000)
    if body["action"] != "PASS":
        pytest.skip("this amount was not a pass under the active engine version")
    row = _settled(body["transaction_id"])
    assert row["state"] == "successful" and row["destination_bank_code"] == "000013" and row["fee"] == 25.0
    assert bank.sends()[0]["payload"]["destination_bank_code"] == "000013"


def test_a_lost_answer_is_queried_and_never_resent(world, bank):
    client, headers = world
    body = _score(client, headers, "0123456789", "0123987001", "Chukwuemeka Ifeanyi Nwosu", "GTBank", "000013", 5_000.02)
    if body["action"] != "PASS":
        pytest.skip("this amount was not a pass under the active engine version")
    row = _settled(body["transaction_id"])
    assert len(bank.sends()) == 1
    from core.db import loads

    assert "unknown" in [s["state"] for s in loads(row["trail"], [])]


def test_a_held_or_flagged_transfer_is_not_sent_until_money_moves(world, bank):
    client, headers = world
    body = _score(client, headers, "0123456792", "0123987004", "Tamunotonye Briggs", "UBA", "000004", 38_000)
    if body["action"] == "PASS":
        pytest.skip("this amount passed under the active engine version")
    time.sleep(0.3)
    from services import forge_transfers

    assert forge_transfers.get(body["transaction_id"]) is None and bank.sends() == []


def test_a_verified_flag_is_sent_when_approved(world, bank):
    from core.db import cursor
    from services import forge_bridge

    client, _ = world
    with cursor() as cur:
        cur.execute("SELECT id FROM customers WHERE institution_id = ? AND external_ref = '0123456790'", (BANK,))
        uid = cur.fetchone()["id"]
        cur.execute("INSERT INTO transactions (id, user_id, amount, recipient_account, recipient_bank, recipient_name, "
                    "institution_id, action_taken, risk_score, shield_signals) VALUES "
                    "('txn_bridgeflag01', ?, 200000, '0123987002', 'Zenith Bank', 'Funmilayo Abiola Ogunleye', ?, "
                    "'FLAG', 0.6, '[]')", (uid, BANK))
    row = forge_bridge.mirror("txn_bridgeflag01")
    assert row["state"] == "successful" and row["destination_bank_code"] == "000015"
    assert forge_bridge.mirror("txn_bridgeflag01")["id"] == "txn_bridgeflag01"
    assert len(bank.sends()) == 1  # a second call returns the same transfer, nothing new is sent


def test_an_unknown_bank_is_recorded_as_not_sent(world, bank):
    from core.db import cursor
    from services import forge_bridge

    with cursor() as cur:
        cur.execute("SELECT id FROM customers WHERE institution_id = ? AND external_ref = '0123456791'", (BANK,))
        uid = cur.fetchone()["id"]
        cur.execute("INSERT INTO transactions (id, user_id, amount, recipient_account, recipient_bank, recipient_name, "
                    "institution_id, action_taken, risk_score, shield_signals) VALUES "
                    "('txn_bridgeunknown', ?, 1000, '1234567890', 'Some Other Bank', 'Someone', ?, 'PASS', 0.1, '[]')",
                    (uid, BANK))
    row = forge_bridge.mirror("txn_bridgeunknown")
    assert row["state"] == "failed" and "not one of the sandbox's banks" in row["last_error"]
    assert bank.sends() == []


def test_another_institution_is_never_sent_to_the_bank(world, bank, monkeypatch):
    from services import forge_bridge

    monkeypatch.setenv("FORGE_BRIDGE_INSTITUTION", "someotherbank")
    assert forge_bridge.mirror("txn_bridgeflag01") is None
    assert bank.sends() == []
