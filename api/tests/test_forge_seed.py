"""The Forge demo puts itself back after a restart, and only when asked to."""
import os
import sys
import tempfile

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
os.environ.setdefault("FABLE_DB_PATH", os.path.join(tempfile.mkdtemp(), "forge-seed.db"))
os.environ.setdefault("FABLE_SESSION_SECRET", "test-secret")

KEY = "fbl_live_" + "ab12" * 8


@pytest.fixture(scope="module")
def client():
    from fastapi.testclient import TestClient

    from main import app

    return TestClient(app)


def test_it_does_nothing_without_a_configured_key(monkeypatch):
    from services import forge_seed

    monkeypatch.delenv("FORGE_DEMO_API_KEY", raising=False)
    assert forge_seed.ensure_from_env() is False


def test_a_configured_key_creates_the_demo_and_authenticates(monkeypatch, client):
    from core import customers, security
    from services import forge_seed

    monkeypatch.setenv("FORGE_DEMO_API_KEY", KEY)
    assert forge_seed.ensure_from_env() is True
    for ref in forge_seed.CUSTOMERS:
        customer = customers.get(forge_seed.INSTITUTION, ref)
        assert customer and security.status(customer["id"]).get("pin_set")
    # The key is accepted: a missing transfer is a 404, not a 401.
    res = client.get("/v1/forge/transfers/txn_000000000000", params={"user_id": "demo_adaeze"},
                     headers={"X-API-Key": KEY})
    assert res.status_code == 404, res.text


def test_running_again_changes_nothing(monkeypatch):
    from core.db import cursor
    from services import forge_seed

    monkeypatch.setenv("FORGE_DEMO_API_KEY", KEY)
    forge_seed.ensure_from_env()
    forge_seed.ensure_from_env()
    with cursor() as cur:
        cur.execute("SELECT COUNT(*) AS n FROM api_keys WHERE institution_id = ?", (forge_seed.INSTITUTION,))
        assert cur.fetchone()["n"] == 1
        cur.execute("SELECT COUNT(*) AS n FROM customers WHERE institution_id = ?", (forge_seed.INSTITUTION,))
        assert cur.fetchone()["n"] == len(forge_seed.CUSTOMERS)


def test_the_institution_is_live(monkeypatch):
    from core.tenancy import institution_mode
    from services import forge_seed

    monkeypatch.setenv("FORGE_DEMO_API_KEY", KEY)
    forge_seed.ensure_from_env()
    assert institution_mode(forge_seed.INSTITUTION) == "live"


@pytest.mark.parametrize("bad", ["short", "fbl_live_x", "notthekey_" + "a" * 30])
def test_a_malformed_key_is_refused_without_creating_anything(bad):
    from services import forge_seed

    with pytest.raises(ValueError):
        forge_seed.ensure_demo(bad)


def test_a_random_key_is_issued_once_when_none_is_configured():
    from core.db import cursor
    from services import forge_seed

    with cursor() as cur:
        cur.execute("UPDATE api_keys SET is_active = 0 WHERE institution_id = ?", (forge_seed.INSTITUTION,))
    out = forge_seed.ensure_demo(None)
    assert out["issued_key"] and out["issued_key"].startswith("fbl_live_")
    assert forge_seed.ensure_demo(None)["issued_key"] is None


def test_a_bad_demo_key_does_not_stop_the_bank_being_set_up(monkeypatch):
    from services import forge_seed

    calls = []
    monkeypatch.setenv("FORGE_DEMO_API_KEY", "not-a-valid-key")
    monkeypatch.setenv("FORGE_BRIDGE_INSTITUTION", "xtradot")
    monkeypatch.setenv("FORGE_CONSOLE_EMAIL", "team11@fable.ng")
    monkeypatch.setenv("FORGE_CONSOLE_PASSWORD", "long-enough-password")
    monkeypatch.setattr(forge_seed, "ensure_bank", lambda *a: calls.append(a) or {"customers": 5, "history": 0})
    assert forge_seed.ensure_from_env() is True
    assert calls == [("xtradot", "team11@fable.ng", "long-enough-password")]
