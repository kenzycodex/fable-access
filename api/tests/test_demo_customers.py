"""Demo customers in the sandbox: a fresh one in one step, and a test
customer's history reset so Shield forgets what testing taught it.

  * Both are sandbox only, and reset only ever touches a test customer.
  * Reset is for owners, needs the reference typed, waits for a hold, and keeps
    the customer, their money, their PIN and any passkey-trusted device.
"""
import os
import secrets
import sys
import tempfile

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
os.environ.setdefault("FABLE_DB_PATH", os.path.join(tempfile.mkdtemp(), "demo-customers.db"))
os.environ.setdefault("FABLE_SESSION_SECRET", "test-secret")

BANK = "demobank"
LIVE = "demolivebank"


@pytest.fixture(scope="module")
def client():
    from fastapi.testclient import TestClient

    from core.db import cursor
    from core.tenancy import register_institution
    from main import app

    register_institution(BANK, "Demo Bank", "risk@demo.ng")
    register_institution(LIVE, "Demo Live Bank", "risk@demolive.ng")
    with cursor() as cur:
        cur.execute("UPDATE institutions SET mode = 'live' WHERE institution_id = ?", (LIVE,))
        cur.execute("INSERT OR REPLACE INTO admins (email, institution_id, hashed_password, role, active) "
                    "VALUES ('analyst@demobank.ng', ?, 'x', 'analyst', 1)", (BANK,))
    return TestClient(app)


def _as(email: str, bank: str) -> dict:
    from core import sessions

    return {"X-Fable-Session": sessions.issue(email, bank)["token"]}


def _owner(bank: str = BANK) -> dict:
    return _as(f"owner@{bank}.ng", bank)


def _count(table: str, user: str) -> int:
    from core.db import cursor

    with cursor() as cur:
        cur.execute(f"SELECT COUNT(*) AS n FROM {table} WHERE user_id = ?", (user,))
        return cur.fetchone()["n"]


def _decide(client, user: str, amount: float = 50_000) -> str:
    res = client.post("/v1/shield/analyze", headers=_owner(), json={
        "user_id": user,
        "transaction": {"amount": amount, "recipient_account": "0123456789", "channel": "mobile_app"},
        "device": {"fingerprint_id": f"fp_{user}"},
        "context": {"latitude": 6.6, "longitude": 3.35, "city": "Ikeja", "country": "Nigeria"},
    })
    assert res.status_code == 200, res.text
    return res.json()["transaction_id"]


def test_a_fresh_demo_customer_in_one_step(client):
    from services import accounts as ledger

    res = client.post("/v1/customers/demo", headers=_as("analyst@demobank.ng", BANK), json={})
    assert res.status_code == 201, res.text
    made = res.json()
    assert made["kind"] == "test" and made["reference"].startswith("demo-") and made["name"]
    assert ledger.get_balance(made["id"], BANK)["available"] == 1_000_000
    assert _count("transactions", made["id"]) == 0
    named = client.post("/v1/customers/demo", headers=_owner(), json={"name": "Ada Demo", "opening_balance": 250_000})
    assert named.json()["name"] == "Ada Demo"
    assert ledger.get_balance(named.json()["id"], BANK)["available"] == 250_000


def test_no_demo_customers_for_a_live_bank(client):
    assert client.post("/v1/customers/demo", headers=_owner(LIVE), json={}).status_code == 409


def test_reset_clears_history_and_keeps_the_customer_money_and_pin(client):
    from agents.copilot.baseline import get_user_baseline
    from core import security
    from core.db import cursor
    from services import accounts as ledger

    made = client.post("/v1/customers/demo", headers=_owner(), json={"opening_balance": 2_000_000}).json()
    user, ref = made["id"], made["reference"]
    security.set_pin(user, "2468", institution_id=BANK)
    for _ in range(4):
        _decide(client, user)
    with cursor() as cur:
        cur.execute("INSERT INTO customer_devices (user_id, institution_id, fingerprint_id, trusted) "
                    "VALUES (?, ?, 'fp_passkey', 1)", (user, BANK))
    assert get_user_baseline(user) is not None
    balance = ledger.get_balance(user, BANK)["available"]

    wrong = client.post(f"/v1/customers/{ref}/reset-history", headers=_owner(), json={"confirm_reference": "nope"})
    assert wrong.status_code == 400
    res = client.post(f"/v1/customers/{ref}/reset-history", headers=_owner(), json={"confirm_reference": ref})
    assert res.status_code == 200, res.text
    assert res.json()["rows_removed"]["transactions"] == 4

    for table in ("transactions", "decision_features", "user_locations"):
        assert _count(table, user) == 0, table
    assert get_user_baseline(user) is None, "Shield starts from no history"
    with cursor() as cur:
        cur.execute("SELECT fingerprint_id FROM customer_devices WHERE user_id = ?", (user,))
        assert [r["fingerprint_id"] for r in cur.fetchall()] == ["fp_passkey"]
        cur.execute("SELECT COUNT(*) AS n FROM audit_log WHERE user_id = ? AND event_type = 'customer.history_reset'",
                    (user,))
        assert cur.fetchone()["n"] == 1
    assert client.get(f"/v1/customers/{ref}", headers=_owner()).status_code == 200
    assert ledger.get_balance(user, BANK)["available"] == balance
    assert security.check_pin(user, "2468")


def test_reset_is_for_owners_test_customers_and_the_sandbox(client):
    from core import customers

    made = client.post("/v1/customers/demo", headers=_owner(), json={}).json()
    analyst = client.post(f"/v1/customers/{made['reference']}/reset-history", headers=_as("analyst@demobank.ng", BANK),
                          json={"confirm_reference": made["reference"]})
    assert analyst.status_code == 403
    real = customers.ensure(BANK, f"real-{secrets.token_hex(3)}", kind="real", source="console")
    res = client.post(f"/v1/customers/{real['external_ref']}/reset-history", headers=_owner(),
                      json={"confirm_reference": real["external_ref"]})
    assert res.status_code == 409 and "test customer" in res.json()["detail"]
    live = customers.ensure(LIVE, f"live-{secrets.token_hex(3)}", kind="real", source="console")
    res = client.post(f"/v1/customers/{live['external_ref']}/reset-history", headers=_owner(LIVE),
                      json={"confirm_reference": live["external_ref"]})
    assert res.status_code == 409 and "sandbox" in res.json()["detail"]


def test_reset_waits_for_a_hold_in_progress(client):
    from core.db import cursor

    made = client.post("/v1/customers/demo", headers=_owner(), json={}).json()
    with cursor() as cur:
        cur.execute("INSERT INTO ghost_containers (ghost_id, user_id, amount, status, institution_id) "
                    "VALUES (?, ?, 1000, 'HELD', ?)", (f"gh_{secrets.token_hex(4)}", made["id"], BANK))
    res = client.post(f"/v1/customers/{made['reference']}/reset-history", headers=_owner(),
                      json={"confirm_reference": made["reference"]})
    assert res.status_code == 409 and "hold" in res.json()["detail"]


def test_a_decision_says_what_it_was_judged_against(client):
    """A new customer is not judged against "how you normally bank"."""
    made = client.post("/v1/customers/demo", headers=_owner(), json={"opening_balance": 5_000_000}).json()

    def source():
        res = client.post("/v1/shield/analyze", headers=_owner(), json={
            "user_id": made["id"],
            "transaction": {"amount": 20_000, "recipient_account": "0123456789", "channel": "branch"},
            "device": {"fingerprint_id": "fp_same"},
        })
        assert res.status_code == 200, res.text
        return res.json()["baseline_source"]

    assert source() in ("population", "none")
    # Passed transfers build the customer's own history; from then on it is theirs.
    later = [source() for _ in range(4)]
    assert later[-1] == "personal", later
