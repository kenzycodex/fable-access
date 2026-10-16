"""Workstream B: tenancy of shared tables, secrets at rest, paid lookups,
and production refusing unsafe settings."""
import base64
import os
import secrets
import sys
import tempfile

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
os.environ.setdefault("FABLE_DB_PATH", os.path.join(tempfile.mkdtemp(), "hardening.db"))
os.environ.setdefault("FABLE_SESSION_SECRET", "test-secret")

A, B = "hardenalpha", "hardenbeta"


def _session(inst: str, email: str | None = None) -> dict:
    from core import sessions

    return {"X-Fable-Session": sessions.issue(email or f"owner@{inst}.ng", inst)["token"]}


@pytest.fixture(scope="module")
def client():
    from fastapi.testclient import TestClient

    from core.tenancy import register_institution
    from main import app
    from services import accounts as ledger

    for inst in (A, B):
        register_institution(inst, inst.title(), f"risk@{inst}.ng")
    from core import customers

    for inst in (A, B):
        c = customers.ensure(inst, "same-ref", kind="test", source="console")
        ledger.ensure_account(c["id"], inst, opening_balance=1_000_000)
    return TestClient(app)


def _uid(inst: str) -> str:
    from core import customers

    return customers.get(inst, "same-ref")["id"]


# ── Devices are per customer ─────────────────────────────────────────────────

def test_one_device_used_at_two_banks_keeps_separate_trust(client):
    from agents.copilot.baseline import _device_trust, record_device_profile

    a, b = _uid(A), _uid(B)
    for _ in range(5):
        record_device_profile(b, {"fingerprint_id": "fp_shared_phone"})
    record_device_profile(a, {"fingerprint_id": "fp_shared_phone"})
    assert _device_trust(a)["fp_shared_phone"] == pytest.approx(0.5)
    assert _device_trust(b)["fp_shared_phone"] > 0.6


def test_old_device_rows_are_copied_to_their_customer_once(client):
    from core import db
    from core.db import cursor

    a = _uid(A)
    with cursor() as cur:
        cur.execute("INSERT OR IGNORE INTO device_profiles (fingerprint_id, user_id, trust_score, times_seen) "
                    "VALUES ('fp_legacy_row', ?, 0.8, 9)", (a,))
    db._backfill_customer_devices(db.get_conn())
    db._backfill_customer_devices(db.get_conn())
    with cursor() as cur:
        cur.execute("SELECT COUNT(*) AS n, MAX(institution_id) AS inst FROM customer_devices "
                    "WHERE fingerprint_id = 'fp_legacy_row'")
        row = cur.fetchone()
    assert row["n"] == 1 and row["inst"] == A


# ── client_reference is unique per bank ──────────────────────────────────────

def test_two_banks_may_use_the_same_client_reference(client):
    body = {"user_id": "same-ref", "client_reference": "shared-ref-1",
            "transaction": {"amount": 1_000, "recipient_account": "0123456789", "channel": "branch"}}
    a = client.post("/v1/shield/analyze", headers=_session(A), json=body)
    b = client.post("/v1/shield/analyze", headers=_session(B), json=body)
    assert a.status_code == 200 and b.status_code == 200, (a.text, b.text)
    assert a.json()["transaction_id"] != b.json()["transaction_id"]
    again = client.post("/v1/shield/analyze", headers=_session(A), json=body)
    assert again.json()["transaction_id"] == a.json()["transaction_id"]


def test_the_global_client_reference_index_is_gone():
    from core.db import cursor

    with cursor() as cur:
        cur.execute("SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'transactions'")
        names = {r["name"] for r in cur.fetchall()}
    assert "ux_txn_inst_client_ref" in names and "ux_txn_client_ref" not in names


# ── Webhook secrets and the master key ring ──────────────────────────────────

def _key() -> str:
    return base64.urlsafe_b64encode(secrets.token_bytes(32)).decode()


def test_webhook_secrets_are_sealed_and_still_sign(monkeypatch):
    from core import config, db
    from core.db import cursor
    from services import webhooks

    monkeypatch.setattr(config, "SECRETS_KEY", _key())
    with cursor() as cur:
        cur.execute("INSERT INTO webhooks (id, institution_id, url, secret, events, active) "
                    "VALUES ('wh_legacy', ?, 'https://hooks.example.ng/x', 'whsec_plain_legacy', 'case.resolved', 1)",
                    (A,))
    db._seal_webhook_secrets(db.get_conn())
    with cursor() as cur:
        cur.execute("SELECT secret, secret_ciphertext FROM webhooks WHERE id = 'wh_legacy'")
        row = cur.fetchone()
    assert row["secret"] == "" and row["secret_ciphertext"]
    assert webhooks.hooks_for(A, "case.resolved")[0]["secret"] == "whsec_plain_legacy"


def test_a_value_sealed_under_the_previous_key_still_opens(monkeypatch):
    from core import config
    from core import secrets as vault

    old, new = _key(), _key()
    monkeypatch.setattr(config, "SECRETS_KEY", old)
    monkeypatch.setattr(config, "SECRETS_KEY_ID", "k1")
    sealed = vault.seal("value-under-old-key", "TEST", 1)
    monkeypatch.setattr(config, "SECRETS_KEY", new)
    monkeypatch.setattr(config, "SECRETS_KEY_ID", "k2")
    with pytest.raises(vault.SecretsError):
        vault.open_sealed(sealed, "TEST", 1)
    monkeypatch.setattr(config, "SECRETS_KEY_PREVIOUS", f"k1:{old}")
    assert vault.open_sealed(sealed, "TEST", 1) == "value-under-old-key"


# ── Paid lookups need a credential ───────────────────────────────────────────

def test_reverse_geocoding_needs_a_credential_and_is_capped(client, monkeypatch):
    from routers import geo
    from services import geocoding

    monkeypatch.setattr(geocoding, "reverse", lambda lat, lon: {"city": "Lagos"})
    assert client.get("/v1/geo/reverse?lat=6.5&lon=3.3").status_code == 401
    assert client.get("/v1/geo/reverse?lat=6.5&lon=3.3", headers=_session(A)).status_code == 200
    monkeypatch.setattr(geo, "PER_INSTITUTION_PER_MINUTE", 1)
    geo._hits.clear()
    assert client.get("/v1/geo/reverse?lat=6.5&lon=3.3", headers=_session(B)).status_code == 200
    assert client.get("/v1/geo/reverse?lat=6.5&lon=3.3", headers=_session(B)).status_code == 429


# ── Production refuses unsafe settings ───────────────────────────────────────

def test_production_problems_name_every_unsafe_setting(monkeypatch):
    from core import config
    from main import production_problems

    monkeypatch.setattr(config, "_SESSION_SECRET_IS_EPHEMERAL", True)
    monkeypatch.setattr(config, "PIN_PEPPER", "")
    monkeypatch.setattr(config, "WEBAUTHN_RP_ID", "localhost")
    monkeypatch.setenv("FABLE_WEBHOOK_ALLOW_PRIVATE", "1")
    problems = " ".join(production_problems(["*"]))
    for name in ("FABLE_SESSION_SECRET", "FABLE_CORS_ORIGINS", "FABLE_PIN_PEPPER", "WEBAUTHN_RP_ID",
                 "FABLE_WEBHOOK_ALLOW_PRIVATE"):
        assert name in problems

    monkeypatch.setattr(config, "_SESSION_SECRET_IS_EPHEMERAL", False)
    monkeypatch.setattr(config, "PIN_PEPPER", "pepper")
    monkeypatch.setattr(config, "WEBAUTHN_RP_ID", "fablehq.vercel.app")
    monkeypatch.delenv("FABLE_WEBHOOK_ALLOW_PRIVATE")
    assert production_problems(["https://fablehq.vercel.app"]) == []


def test_credentials_never_reach_the_audit_log(client):
    from core.db import cursor
    from services import audit

    audit.record("test.redaction", None, institution_id=A, pin="1234", stepup_token="su_x", password="p", ok=1)
    with cursor() as cur:
        cur.execute("SELECT payload FROM audit_log WHERE event_type = 'test.redaction' ORDER BY id DESC LIMIT 1")
        payload = cur.fetchone()["payload"]
    assert "1234" not in payload and "su_x" not in payload and '"ok": 1' in payload
