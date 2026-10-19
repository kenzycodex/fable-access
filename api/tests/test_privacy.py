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
