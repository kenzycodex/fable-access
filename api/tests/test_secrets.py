"""The integration-keys manager: every promise in docs/SECRETS.md, tested.

Encryption binds each value to its slot; the server environment wins; no
endpoint, audit row or log line ever holds a value; only owners act, each
time with a fresh factor; a second owner approves (or, with one owner, a
cooling-off period runs); a compromised key can never come back; proposed
values are encrypted and wiped once decided; the audit is hash-chained.
"""
import base64
import logging
import os
import sys

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
os.environ.setdefault("FABLE_SESSION_SECRET", "test-secret")

OWNER_A, OWNER_B, SUPPORT = "keys-a@fable.test", "keys-b@fable.test", "keys-support@fable.test"
SECRETS = {}
KEY = "sk-test-" + "Q" * 24
NEW_KEY = "sk-test-" + "R" * 24
MASTER = base64.urlsafe_b64encode(b"m" * 32).decode()


def _operator(email: str, role: str) -> None:
    from core import operators, totp
    from core.db import cursor
    from scripts.create_operator import create

    create(email, email.split("@")[0], role, "a-long-test-password")
    secret = totp.new_secret()
    SECRETS[email] = secret
    with cursor() as cur:
        cur.execute("UPDATE operators SET totp_enabled = 1, totp_secret = ?, totp_last_step = NULL, active = 1, role = ? "
                    "WHERE email = ?", (operators.seal(secret), role, email))


def _session(email: str) -> dict:
    from core import operators

    return {"X-Fable-Operator": operators.issue_session(email, 0)["token"]}


def _code(email: str) -> dict:
    """A fresh authenticator code. The replay marker is reset first so one test
    can step up several times; replay itself is tested on its own below."""
    from core import totp
    from core.db import cursor

    with cursor() as cur:
        cur.execute("UPDATE operators SET totp_last_step = NULL WHERE email = ?", (email,))
    return {"code": totp.code_at(SECRETS[email], totp.current_step())}


@pytest.fixture(scope="module")
def client():
    from fastapi.testclient import TestClient

    from main import app

    _operator(OWNER_A, "platform_owner")
    _operator(OWNER_B, "platform_owner")
    _operator(SUPPORT, "support")
    return TestClient(app)


@pytest.fixture(autouse=True)
def clean(client, monkeypatch):
    from core import config
    from core import secrets as vault
    from core.db import cursor
    from routers import operator_secrets
    from services import secret_admin

    monkeypatch.setattr(config, "SECRETS_KEY", MASTER)
    monkeypatch.setattr(config, "SECRETS_WRITE", True)
    for probe in list(secret_admin.PROBES):
        monkeypatch.setitem(secret_admin.PROBES, probe, lambda v: (v.startswith("sk-test-"), "Accepted by the provider."))
    with cursor() as cur:
        for table in ("platform_secrets", "secret_changes", "operator_stepup"):
            cur.execute(f"DELETE FROM {table}")
        # Both owners active unless a test says otherwise; nobody else owns.
        cur.execute("UPDATE operators SET role = 'platform_admin' WHERE role = 'platform_owner' AND email NOT IN (?, ?)",
                    (OWNER_A, OWNER_B))
        cur.execute("UPDATE operators SET role = 'platform_owner', active = 1 WHERE email IN (?, ?)", (OWNER_A, OWNER_B))
    operator_secrets._hits.clear()
    vault.bump_generation()
    yield


def _propose(client, name="OPENAI_API_KEY", value=KEY, who=OWNER_A, rotation="routine"):
    return client.post(f"/operator/secrets/{name}/propose", headers=_session(who),
                       json={"value": value, "reason": "Quarterly rotation", "rotation": rotation, "step_up": _code(who)})


def _approve(client, cid, who=OWNER_B):
    return client.post(f"/operator/secrets/changes/{cid}/approve", headers=_session(who), json={"step_up": _code(who)})


def _set(client, value=KEY, rotation="routine"):
    r = _propose(client, value=value, rotation=rotation)
    assert r.status_code == 200, r.text
    a = _approve(client, r.json()["id"])
    assert a.status_code == 200, a.text
    return a.json()


# ── Encryption ───────────────────────────────────────────────────────────────

def test_a_sealed_value_opens_only_in_its_own_slot_with_the_right_key():
    from core import secrets as vault

    key = base64.urlsafe_b64decode(MASTER)
    sealed = vault.seal("value-1234", "OPENAI_API_KEY", 3, key=key)
    assert vault.open_sealed(sealed, "OPENAI_API_KEY", 3, key=key) == "value-1234"
    assert b"value-1234" not in sealed["ciphertext"]
    for name, version, k in (("ANTHROPIC_API_KEY", 3, key), ("OPENAI_API_KEY", 4, key), ("OPENAI_API_KEY", 3, b"x" * 32)):
        with pytest.raises(vault.SecretsError):
            vault.open_sealed(sealed, name, version, key=k)
    tampered = {**sealed, "ciphertext": bytes([sealed["ciphertext"][0] ^ 1]) + sealed["ciphertext"][1:]}
    with pytest.raises(vault.SecretsError):
        vault.open_sealed(tampered, "OPENAI_API_KEY", 3, key=key)


# ── Maker-checker, and values never leaving ──────────────────────────────────

def test_a_second_owner_approves_and_no_value_is_ever_returned_or_logged(client, caplog):
    from core import secrets as vault
    from core.db import cursor

    caplog.set_level(logging.DEBUG)
    proposed = _propose(client)
    assert proposed.status_code == 200 and proposed.json()["status"] == "pending"
    cid = proposed.json()["id"]
    with cursor() as cur:
        cur.execute("SELECT ciphertext FROM secret_changes WHERE id = ?", (cid,))
        assert KEY.encode() not in bytes(cur.fetchone()[0]), "a proposed value is stored encrypted"

    assert _approve(client, cid, who=OWNER_A).status_code == 403, "the proposer cannot approve"
    applied = _approve(client, cid)
    assert applied.status_code == 200 and applied.json()["status"] == "applied"
    assert vault.get("OPENAI_API_KEY") == KEY

    listing = client.get("/operator/secrets", headers=_session(SUPPORT))
    assert listing.status_code == 200 and listing.headers["cache-control"] == "no-store"
    item = next(i for i in listing.json()["items"] if i["name"] == "OPENAI_API_KEY")
    assert item["source"] == "console" and item["active"]["last4"] == "…" + KEY[-4:]

    everything = proposed.text + applied.text + listing.text + caplog.text
    with cursor() as cur:
        cur.execute("SELECT payload FROM audit_log")
        everything += "".join(r[0] or "" for r in cur.fetchall())
        cur.execute("SELECT detail FROM secret_audit")
        everything += "".join(r[0] or "" for r in cur.fetchall())
        cur.execute("SELECT ciphertext FROM secret_changes WHERE id = ?", (cid,))
        assert cur.fetchone()[0] is None, "a decided proposal is wiped"
    assert KEY not in everything


def test_only_owners_act_and_each_action_needs_a_fresh_factor(client):
    assert client.post("/operator/secrets/OPENAI_API_KEY/propose", headers=_session(SUPPORT),
                       json={"value": KEY, "reason": "Quarterly rotation", "step_up": {"code": "000000"}}).status_code == 403
    assert client.post("/operator/secrets/OPENAI_API_KEY/propose", headers=_session(OWNER_A),
                       json={"value": KEY, "reason": "Quarterly rotation"}).status_code == 422
    assert client.post("/operator/secrets/OPENAI_API_KEY/propose", headers=_session(OWNER_A),
                       json={"value": KEY, "reason": "Quarterly rotation", "step_up": {}}).status_code == 401

    code = _code(OWNER_A)
    first = client.post("/operator/secrets/OPENAI_API_KEY/propose", headers=_session(OWNER_A),
                        json={"value": KEY, "reason": "Quarterly rotation", "step_up": code})
    assert first.status_code == 200
    replay = client.post("/operator/secrets/ANTHROPIC_API_KEY/propose", headers=_session(OWNER_A),
                         json={"value": KEY, "reason": "Quarterly rotation", "step_up": code})
    assert replay.status_code == 401, "a used code cannot be used again"


def test_five_failed_step_ups_lock_key_actions_but_not_the_account(client):
    for _ in range(4):
        r = client.post("/operator/secrets/OPENAI_API_KEY/propose", headers=_session(OWNER_A),
                        json={"value": KEY, "reason": "Quarterly rotation", "step_up": {"code": "000000"}})
        assert r.status_code == 401
    r = client.post("/operator/secrets/OPENAI_API_KEY/propose", headers=_session(OWNER_A),
                    json={"value": KEY, "reason": "Quarterly rotation", "step_up": {"code": "000000"}})
    assert r.status_code == 423
    assert _propose(client).status_code == 423, "even a right code waits out the lock"
    assert client.get("/operator/me", headers=_session(OWNER_A)).status_code == 200, "sign-in is unaffected"
    assert client.get("/operator/institutions", headers=_session(OWNER_A)).status_code == 200


def test_the_server_environment_wins_and_is_read_only_here(client, monkeypatch):
    from core import secrets as vault

    monkeypatch.setenv("OPENAI_API_KEY", "env-key-" + "E" * 20)
    assert vault.get("OPENAI_API_KEY") == "env-key-" + "E" * 20
    assert _propose(client).status_code == 409
    item = next(i for i in client.get("/operator/secrets", headers=_session(SUPPORT)).json()["items"]
                if i["name"] == "OPENAI_API_KEY")
    assert item["source"] == "environment" and "EEEE" in item["display"] and "env-key" not in item["display"]


def test_a_key_the_provider_refuses_is_never_stored(client):
    r = _propose(client, value="not-a-real-key-123")
    assert r.status_code == 422 and "refused" in r.json()["detail"]


def test_models_come_from_the_allowlist(client):
    assert _propose(client, name="OPENAI_MODEL", value="gpt-anything").status_code == 422
    ok = _propose(client, name="OPENAI_MODEL", value="gpt-4o-mini")
    assert ok.status_code == 200
    assert _approve(client, ok.json()["id"]).status_code == 200
    from core import ai_clients

    assert ai_clients.openai_model() == "gpt-4o-mini"


# ── Rotation, rollback, compromise ───────────────────────────────────────────

def test_a_routine_rotation_can_be_rolled_back_after_a_fresh_test(client, monkeypatch):
    from core import secrets as vault
    from services import secret_admin

    _set(client, KEY)
    _set(client, NEW_KEY)
    assert vault.get("OPENAI_API_KEY") == NEW_KEY
    body = {"version": 1, "reason": "New key misbehaves", "step_up": _code(OWNER_A)}
    proposed = client.post("/operator/secrets/OPENAI_API_KEY/rollback", headers=_session(OWNER_A), json=body)
    assert proposed.status_code == 200, proposed.text
    assert _approve(client, proposed.json()["id"]).status_code == 200
    assert vault.get("OPENAI_API_KEY") == KEY

    # A rollback re-tests the old key: one the provider now refuses is not restored.
    monkeypatch.setitem(secret_admin.PROBES, "openai", lambda v: (False, "Rejected by the provider (HTTP 401)."))
    body = {"version": 2, "reason": "Back again", "step_up": _code(OWNER_A)}
    refused = client.post("/operator/secrets/OPENAI_API_KEY/rollback", headers=_session(OWNER_A), json=body)
    assert refused.status_code == 422 and "no longer works" in refused.json()["detail"]


def test_a_compromised_key_is_revoked_and_can_never_come_back(client):
    from core.db import cursor

    _set(client, KEY)
    _set(client, NEW_KEY, rotation="compromised")
    with cursor() as cur:
        cur.execute("SELECT status, ciphertext FROM platform_secrets WHERE name = 'OPENAI_API_KEY' AND version = 1")
        status, ciphertext = cur.fetchone()
    assert status == "revoked" and ciphertext is None
    r = client.post("/operator/secrets/OPENAI_API_KEY/rollback", headers=_session(OWNER_A),
                    json={"version": 1, "reason": "Undo please", "step_up": _code(OWNER_A)})
    assert r.status_code == 409 and "never be restored" in r.json()["detail"]


# ── One owner, expiry, rejection ─────────────────────────────────────────────

def test_with_one_owner_a_change_waits_out_a_cooling_off_period(client):
    from core import secrets as vault
    from core.db import cursor
    from services import secret_admin

    with cursor() as cur:
        cur.execute("UPDATE operators SET role = 'platform_admin' WHERE email = ?", (OWNER_B,))
    r = _propose(client)
    assert r.status_code == 200 and r.json()["status"] == "cooling" and r.json()["single_approver"]
    secret_admin.sweep()
    assert vault.get("OPENAI_API_KEY") == "", "nothing applies before the cooling-off ends"

    with cursor() as cur:
        cur.execute("UPDATE secret_changes SET apply_after = '2000-01-01 00:00:00' WHERE id = ?", (r.json()["id"],))
    secret_admin.sweep()
    vault.bump_generation()
    assert vault.get("OPENAI_API_KEY") == KEY
    with cursor() as cur:
        cur.execute("SELECT detail FROM secret_audit WHERE event = 'secret.set_applied' ORDER BY id DESC LIMIT 1")
        assert '"single_approver": true' in cur.fetchone()[0]


def test_a_cooling_change_can_be_cancelled_and_its_value_is_wiped(client):
    from core.db import cursor

    with cursor() as cur:
        cur.execute("UPDATE operators SET role = 'platform_admin' WHERE email = ?", (OWNER_B,))
    cid = _propose(client).json()["id"]
    r = client.post(f"/operator/secrets/changes/{cid}/reject", headers=_session(OWNER_A), json={})
    assert r.status_code == 200 and r.json()["status"] == "cancelled"
    with cursor() as cur:
        cur.execute("SELECT ciphertext, wrapped_key FROM secret_changes WHERE id = ?", (cid,))
        assert tuple(cur.fetchone()) == (None, None)


def test_an_unapproved_change_expires_and_is_wiped(client):
    from core.db import cursor
    from services import secret_admin

    cid = _propose(client).json()["id"]
    with cursor() as cur:
        cur.execute("UPDATE secret_changes SET expires_at = '2000-01-01 00:00:00' WHERE id = ?", (cid,))
    secret_admin.sweep()
    with cursor() as cur:
        cur.execute("SELECT status, ciphertext FROM secret_changes WHERE id = ?", (cid,))
        assert tuple(cur.fetchone()) == ("expired", None)
    assert _approve(client, cid).status_code == 409


# ── Integrity and break-glass ────────────────────────────────────────────────

def test_the_secret_audit_is_a_hash_chain_that_shows_tampering(client):
    from core.db import cursor
    from services import secret_admin

    _set(client, KEY)
    ok, rows, broken = secret_admin.verify_chain()
    assert ok and rows >= 2 and broken is None
    with cursor() as cur:
        cur.execute("SELECT MIN(id) FROM secret_audit")
        first = cur.fetchone()[0]
        cur.execute("UPDATE secret_audit SET actor = 'someone-else' WHERE id = ?", (first,))
    ok, _, broken = secret_admin.verify_chain()
    assert not ok and broken == str(first)
    with cursor() as cur:  # put it back for later tests
        cur.execute("DELETE FROM secret_audit")


def test_break_glass_makes_the_console_read_only(client, monkeypatch):
    from core import config

    monkeypatch.setattr(config, "SECRETS_WRITE", False)
    assert _propose(client).status_code == 423
    assert client.get("/operator/secrets", headers=_session(SUPPORT)).json()["write_enabled"] is False


def test_logs_never_carry_a_loaded_key(caplog):
    from core import secrets as vault

    vault.remember(KEY)
    record = logging.LogRecord("x", logging.WARNING, __file__, 1, "provider said %s", (KEY,), None)
    vault.ScrubFilter().filter(record)
    assert KEY not in record.getMessage() and "[secret]" in record.getMessage()
    assert vault.scrub("token sk-ant-abcdefghijklmnop end") == "token [secret] end"


def test_env_keys_can_be_imported_on_the_server_without_printing_them(client, monkeypatch, capsys):
    import scripts.import_env_secrets as importer
    from core import secrets as vault

    monkeypatch.setenv("GEOAPIFY_API_KEY", "geo-" + "G" * 20)
    monkeypatch.setattr(sys, "argv", ["import", "--apply"])
    assert importer.main() == 0
    out = capsys.readouterr().out
    assert "GEOAPIFY_API_KEY" in out and "G" * 20 not in out
    monkeypatch.delenv("GEOAPIFY_API_KEY")
    vault.bump_generation()
    assert vault.get("GEOAPIFY_API_KEY") == "geo-" + "G" * 20
    assert vault.source("GEOAPIFY_API_KEY") == "console"
