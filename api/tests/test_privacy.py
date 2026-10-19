"""Personal data is kept no more precisely, and no longer, than Fable needs.

  * Coordinates are stored to about 1 km and IP addresses without their host part,
    both on new decisions and, once, on rows stored before.
"""
import os
import secrets
import sys
import tempfile

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
os.environ.setdefault("FABLE_DB_PATH", os.path.join(tempfile.mkdtemp(), "privacy.db"))
os.environ.setdefault("FABLE_SESSION_SECRET", "test-secret")

BANK = "privacybank"


@pytest.fixture(scope="module")
def client():
    from fastapi.testclient import TestClient

    from core.tenancy import register_institution
    from main import app

    register_institution(BANK, "Privacy Bank", "risk@privacy.ng")
    return TestClient(app)


def _session() -> dict:
    from core import sessions

    return {"X-Fable-Session": sessions.issue(f"owner@{BANK}.ng", BANK)["token"]}


def _customer(ref: str) -> str:
    from core import customers
    from services import accounts as ledger

    user = customers.ensure(BANK, ref, kind="test", source="console")["id"]
    ledger.ensure_account(user, BANK, opening_balance=1_000_000)
    return user


@pytest.mark.parametrize("raw,cut", [
    ("102.89.33.147", "102.89.33.0"),
    ("2c0f:f4c0:1234:5678:9abc::1", "2c0f:f4c0:1234::"),
    ("not an ip", None),
    (None, None),
])
def test_ip_addresses_lose_their_host_part(raw, cut):
    from core.privacy import truncate_ip

    assert truncate_ip(raw) == cut


def test_a_decision_stores_coarse_location_and_ip(client):
    from core.db import cursor

    user = _customer(f"loc-{secrets.token_hex(3)}")
    res = client.post("/v1/shield/analyze", headers=_session(), json={
        "user_id": user,
        "transaction": {"amount": 5000, "recipient_account": "0123456789", "channel": "mobile_app"},
        "device": {"fingerprint_id": "fp_privacy", "ip": "102.89.33.147"},
        "context": {"latitude": 6.601234, "longitude": 3.351987, "city": "Ikeja", "country": "Nigeria",
                    "location_source": "gps"},
    })
    assert res.status_code == 200, res.text
    with cursor() as cur:
        cur.execute("SELECT latitude, longitude, client_ip FROM transactions WHERE id = ?", (res.json()["transaction_id"],))
        row = cur.fetchone()
        assert (row["latitude"], row["longitude"], row["client_ip"]) == (6.6, 3.35, "102.89.33.0")
        cur.execute("SELECT latitude, longitude FROM user_locations WHERE user_id = ?", (user,))
        assert [tuple(r) for r in cur.fetchall()] == [(6.6, 3.35)]


def test_rows_stored_before_are_coarsened_once(client):
    from core import privacy
    from core.db import cursor, get_conn

    txid = f"txn_{secrets.token_hex(6)}"
    with cursor() as cur:
        cur.execute("INSERT INTO transactions (id, user_id, amount, latitude, longitude, client_ip, institution_id) "
                    "VALUES (?, 'old', 100, 9.076543, 7.398765, '41.58.12.34', ?)", (txid, BANK))
    conn = get_conn()
    assert privacy.backfill_precision(conn) >= 1
    conn.commit()
    assert privacy.backfill_precision(conn) == 0, "idempotent"
    with cursor() as cur:
        cur.execute("SELECT latitude, longitude, client_ip FROM transactions WHERE id = ?", (txid,))
        assert tuple(cur.fetchone()) == (9.08, 7.4, "41.58.12.0")


# ── Export and erasure ──────────────────────────────────────────────────────

def _decide(client, user: str, amount: float = 5000, account: str = "0123456789") -> str:
    res = client.post("/v1/shield/analyze", headers=_session(), json={
        "user_id": user,
        "transaction": {"amount": amount, "recipient_account": account, "recipient_name": "TEST PAYEE",
                        "narration": "school fees", "channel": "mobile_app"},
        "device": {"fingerprint_id": "fp_rights", "ip": "102.89.1.2"},
        "context": {"latitude": 6.6, "longitude": 3.35, "city": "Ikeja", "country": "Nigeria"},
    })
    assert res.status_code == 200, res.text
    return res.json()["transaction_id"]


def test_an_owner_exports_everything_held_about_a_customer(client):
    from core import security

    ref = f"exp-{secrets.token_hex(3)}"
    user = _customer(ref)
    security.set_pin(user, "2468", institution_id=BANK)
    txid = _decide(client, user)
    res = client.get(f"/v1/customers/{ref}/export", headers=_session())
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["customer"]["external_ref"] == ref
    assert [d["id"] for d in body["decisions"]] == [txid]
    assert body["decisions"][0]["narration"] == "school fees"
    assert "pin_hash" not in body["security"] and body["security"]["pin_set_at"]
    assert body["devices"] and body["locations"][0]["city"] == "Ikeja"


def test_only_an_owner_can_export_or_erase(client):
    from core import sessions

    ref = f"role-{secrets.token_hex(3)}"
    _customer(ref)
    from core.db import cursor

    with cursor() as cur:
        cur.execute("INSERT OR REPLACE INTO admins (email, institution_id, hashed_password, role, active) "
                    "VALUES ('analyst@privacybank.ng', ?, 'x', 'analyst', 1)", (BANK,))
    analyst = {"X-Fable-Session": sessions.issue("analyst@privacybank.ng", BANK)["token"]}
    assert client.get(f"/v1/customers/{ref}/export", headers=analyst).status_code == 403
    assert client.post(f"/v1/customers/{ref}/erase", headers=analyst, json={"confirm_reference": ref}).status_code == 403


def test_erasure_removes_what_identifies_the_customer_and_keeps_anonymous_outcomes(client):
    from core.db import cursor

    ref = f"era-{secrets.token_hex(3)}"
    user = _customer(ref)
    txid = _decide(client, user)
    with cursor() as cur:
        cur.execute("INSERT INTO case_notes (transaction_id, institution_id, author, body) VALUES (?, ?, 'a', 'Spoke to Ada')",
                    (txid, BANK))
    wrong = client.post(f"/v1/customers/{ref}/erase", headers=_session(), json={"confirm_reference": "nope"})
    assert wrong.status_code == 400
    res = client.post(f"/v1/customers/{ref}/erase", headers=_session(), json={"confirm_reference": ref})
    assert res.status_code == 200, res.text
    alias = res.json()["alias"]
    with cursor() as cur:
        cur.execute("SELECT * FROM transactions WHERE id = ?", (txid,))
        row = dict(cur.fetchone())
        assert row["user_id"] == alias and row["amount"] == 5000 and row["action_taken"]
        for col in ("recipient_account", "recipient_name", "narration", "device_fingerprint", "client_ip", "latitude",
                    "city", "shield_signals", "explanation"):
            assert row[col] is None, col
        for table in ("customers", "user_locations", "customer_devices", "accounts", "ledger_entries"):
            key = "id" if table == "customers" else "user_id"
            cur.execute(f"SELECT COUNT(*) AS n FROM {table} WHERE {key} = ?", (user,))
            assert cur.fetchone()["n"] == 0, table
        cur.execute("SELECT COUNT(*) AS n FROM case_notes WHERE transaction_id = ?", (txid,))
        assert cur.fetchone()["n"] == 0
        cur.execute("SELECT COUNT(*) AS n FROM audit_log WHERE user_id = ?", (user,))
        assert cur.fetchone()["n"] == 0
        cur.execute("SELECT payload FROM audit_log WHERE event_type = 'data.erased' AND user_id = ?", (alias,))
        assert ref not in cur.fetchone()["payload"]
    assert client.get(f"/v1/customers/{ref}/export", headers=_session()).status_code == 404


def test_an_erased_customer_does_not_come_back_on_restart(client):
    from core.db import _backfill_customers, cursor, get_conn

    ref = f"back-{secrets.token_hex(3)}"
    user = _customer(ref)
    _decide(client, user)
    alias = client.post(f"/v1/customers/{ref}/erase", headers=_session(), json={"confirm_reference": ref}).json()["alias"]
    _backfill_customers(get_conn())
    with cursor() as cur:
        cur.execute("SELECT COUNT(*) AS n FROM customers WHERE id = ?", (alias,))
        assert cur.fetchone()["n"] == 0


def test_erasure_waits_for_a_hold_in_progress(client):
    from core.db import cursor

    ref = f"hold-{secrets.token_hex(3)}"
    user = _customer(ref)
    with cursor() as cur:
        cur.execute("INSERT INTO ghost_containers (ghost_id, user_id, amount, status, institution_id) "
                    "VALUES (?, ?, 1000, 'HELD', ?)", (f"gh_{secrets.token_hex(4)}", user, BANK))
    res = client.post(f"/v1/customers/{ref}/erase", headers=_session(), json={"confirm_reference": ref})
    assert res.status_code == 409


# ── Retention ───────────────────────────────────────────────────────────────

def test_retention_clears_detail_then_deletes(client, monkeypatch):
    from core import config
    from core.db import cursor
    from services import retention

    monkeypatch.setattr(config, "RETENTION_DAYS", 1825)
    monkeypatch.setattr(config, "RETENTION_DETAIL_DAYS", 730)
    old_detail, very_old = f"txn_{secrets.token_hex(5)}", f"txn_{secrets.token_hex(5)}"
    with cursor() as cur:
        for txid, days in ((old_detail, 800), (very_old, 2000)):
            cur.execute("""INSERT INTO transactions (id, user_id, amount, recipient_account, device_fingerprint,
                             client_ip, city, latitude, action_taken, institution_id, created_at)
                           VALUES (?, 'ret', 100, '0123456789', 'fp', '1.2.3.0', 'Ikeja', 6.6, 'PASS', ?,
                                   datetime('now', ?))""", (txid, BANK, f"-{days} days"))
    retention.apply()
    with cursor() as cur:
        cur.execute("SELECT * FROM transactions WHERE id = ?", (old_detail,))
        row = dict(cur.fetchone())
        assert row["recipient_account"] == "0123456789" and row["amount"] == 100
        assert row["device_fingerprint"] is None and row["client_ip"] is None and row["city"] is None
        cur.execute("SELECT COUNT(*) AS n FROM transactions WHERE id = ?", (very_old,))
        assert cur.fetchone()["n"] == 0
    assert retention.apply()["transactions"] == 0, "idempotent"


# ── Location opt-out ────────────────────────────────────────────────────────

def test_a_customer_who_opts_out_of_location_has_none_stored_or_scored(client):
    from core import security
    from core.db import cursor

    ref = f"opt-{secrets.token_hex(3)}"
    user = _customer(ref)
    security.set_pin(user, "1357", institution_id=BANK)
    # Turning it off needs a factor the customer already has.
    bare = client.post(f"/v1/accounts/{user}/security/location", headers=_session(), json={"share": False})
    assert bare.status_code == 400
    res = client.post(f"/v1/accounts/{user}/security/location", headers=_session(),
                      json={"share": False, "current_pin": "1357"})
    assert res.status_code == 200 and res.json()["location_shared"] is False
    txid = _decide(client, user)
    with cursor() as cur:
        cur.execute("SELECT latitude, longitude, city, country FROM transactions WHERE id = ?", (txid,))
        assert tuple(cur.fetchone()) == (None, None, None, None)
        cur.execute("SELECT COUNT(*) AS n FROM user_locations WHERE user_id = ?", (user,))
        assert cur.fetchone()["n"] == 0
    # Turning it back on needs nothing.
    on = client.post(f"/v1/accounts/{user}/security/location", headers=_session(), json={"share": True})
    assert on.status_code == 200 and on.json()["location_shared"] is True
