"""The Engine page: every promise in docs/ENGINE-GOVERNANCE.md, tested.

Version 1 changes nothing; every decision records its version and parts;
stored decisions replay exactly; bounds, floors, the step cap and the drift
cap hold; nothing is proposed without a fresh backtest and a step-up; a
second owner approves (or a cooling-off runs); approved parameters are
frozen; shadow never touches a live decision, even when it fails; promotion
is immediate and rollback exact; the environment wins; the backtest is
honest about outcomes; and the audit chain stays intact.
"""
import json
import os
import secrets as pysecrets
import sys
from datetime import datetime, timedelta, timezone

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
os.environ.setdefault("FABLE_SESSION_SECRET", "test-secret")

BANK = "enginebank"
OWNER_A, OWNER_B, ADMIN = "engine-a@fable.test", "engine-b@fable.test", "engine-admin@fable.test"
SECRETS = {}


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


def _op(email: str) -> dict:
    from core import operators

    return {"X-Fable-Operator": operators.issue_session(email, 0)["token"]}


def _code(email: str) -> dict:
    from core import totp
    from core.db import cursor

    with cursor() as cur:
        cur.execute("UPDATE operators SET totp_last_step = NULL WHERE email = ?", (email,))
    return {"code": totp.code_at(SECRETS[email], totp.current_step())}


def _bank_session() -> dict:
    from core import sessions

    return {"X-Fable-Session": sessions.issue("risk@enginebank.ng", BANK)["token"]}


@pytest.fixture(scope="module")
def client():
    from fastapi.testclient import TestClient
    from helpers import seed_bank

    from main import app

    seed_bank(BANK, "Engine Bank")
    _operator(OWNER_A, "platform_owner")
    _operator(OWNER_B, "platform_owner")
    _operator(ADMIN, "platform_admin")
    with TestClient(app) as c:
        yield c


@pytest.fixture(autouse=True)
def clean(client, monkeypatch):
    """Each test starts from version 1 alone, live, with two owners."""
    from core import engine_config
    from core.db import cursor
    from routers import operator_secrets

    for path in engine_config.env_overrides():
        monkeypatch.delenv(engine_config.env_name(path), raising=False)
    with cursor() as cur:
        cur.execute("DELETE FROM engine_versions WHERE version > 1")
        cur.execute("DELETE FROM engine_activations WHERE version != 1 OR kind != 'seed'")
        cur.execute("UPDATE engine_activations SET ended_at = NULL")
        cur.execute("UPDATE engine_versions SET status = 'active', retired_at = NULL WHERE version = 1")
        cur.execute("DELETE FROM operator_stepup")
        cur.execute("UPDATE operators SET role = 'platform_admin' WHERE role = 'platform_owner' AND email NOT IN (?, ?)",
                    (OWNER_A, OWNER_B))
        cur.execute("UPDATE operators SET role = 'platform_owner', active = 1 WHERE email IN (?, ?)", (OWNER_A, OWNER_B))
    engine_config.seed_if_empty()
    engine_config.bump_generation()
    operator_secrets._hits.clear()
    yield


def _decide(client, amount=4000, account="0123456789", key="tunde", **over) -> dict:
    from helpers import ref

    res = client.post("/v1/shield/analyze", headers=_bank_session(), json={
        "user_id": ref(BANK, key),
        "transaction": {"amount": amount, "recipient_account": account, "narration": "", "channel": "mobile_app", **over},
    })
    assert res.status_code == 200, res.text
    return res.json()


def _active_params() -> dict:
    from core import engine_config

    return engine_config.normalise(engine_config.active()["stored"])


def _draft(client, change=None, who=ADMIN, note="Test change"):
    params = _active_params()
    for path, value in (change or {}).items():
        parts = path.split(".")
        if parts[0] == "weights":
            params["weights"][parts[1]] = value
        else:
            params["thresholds"][parts[1]][parts[2]] = value
    return client.post("/operator/engine/drafts", headers=_op(who), json={"params": params, "note": note})


def _approved_version(client, change=None) -> int:
    r = _draft(client, change or {"weights.time_anomaly": 0.14})
    assert r.status_code == 200, r.text
    v = r.json()["version"]
    assert client.post(f"/operator/engine/versions/{v}/backtest", headers=_op(ADMIN), json={"days": 30}).status_code == 200
    p = client.post(f"/operator/engine/versions/{v}/propose", headers=_op(OWNER_A),
                    json={"step_up": _code(OWNER_A), "acknowledge_impact": True})
    assert p.status_code == 200, p.text
    a = client.post(f"/operator/engine/versions/{v}/approve", headers=_op(OWNER_B),
                    json={"step_up": _code(OWNER_B), "acknowledge_impact": True})
    assert a.status_code == 200, a.text
    return v


def _insert(parts=None, signals=None, *, action="PASS", channel="mobile_app", institution=BANK, outcome=None,
            status=None, days_ago=1) -> str:
    from core.db import cursor, dumps

    txid = f"txn_{pysecrets.token_hex(6)}"
    when = (datetime.now(timezone.utc) - timedelta(days=days_ago)).strftime("%Y-%m-%dT%H:%M:%S")
    with cursor() as cur:
        cur.execute(
            """INSERT INTO transactions (id, user_id, amount, channel, risk_score, action_taken, shield_signals,
                 score_parts, review_outcome, status, created_at, institution_id)
               VALUES (?, 'synthetic', 1000, ?, 0.5, ?, ?, ?, ?, ?, ?, ?)""",
            (txid, channel, action, dumps(signals or []), dumps(parts) if parts is not None else None, outcome,
             status, when, institution),
        )
    return txid


def _fixed(score: float) -> dict:
    return {"terms": [[{}, score, 1, 0]], "tenure": 0.0, "nip34": False}


# ── Version 1, and the version on every decision ─────────────────────────────

def test_version_one_is_seeded_from_the_values_in_force(client, monkeypatch):
    """Seeding takes the environment over the code defaults, so shipping the
    Engine page changes no decision."""
    from core import engine_config
    from core.db import cursor

    with cursor() as cur:
        cur.execute("SELECT * FROM engine_versions WHERE version = 1")
        saved = dict(cur.fetchone())
        cur.execute("DELETE FROM engine_versions")
    try:
        monkeypatch.setenv("FABLE_W_TIME_ANOMALY", "0.13")
        monkeypatch.setenv("FABLE_THRESHOLD_USSD_BLOCK", "0.83")
        engine_config.seed_if_empty()
        with cursor() as cur:
            cur.execute("SELECT params, approved_hash, status FROM engine_versions WHERE version = 1")
            row = cur.fetchone()
        seeded = json.loads(row["params"])
        assert row["status"] == "active"
        assert seeded == engine_config.normalise(engine_config.apply_env(engine_config.code_defaults()))
        assert seeded["weights"]["time_anomaly"] == 0.13 and seeded["thresholds"]["ussd"]["block"] == 0.83
        assert row["approved_hash"] == engine_config.params_hash(seeded)
    finally:
        with cursor() as cur:
            cur.execute("DELETE FROM engine_versions")
            cols = ", ".join(saved)
            cur.execute(f"INSERT INTO engine_versions ({cols}) VALUES ({', '.join('?' for _ in saved)})",
                        list(saved.values()))
        engine_config.bump_generation()


def test_stored_decisions_replay_exactly_under_unchanged_parameters(client):
    from agents.shield import weights as W
    from core import engine_config
    from core.db import cursor

    active = engine_config.active()
    assert active["version"] == 1

    seen = [_decide(client, amount=a, account=acct)
            for a, acct in ((3000, "0789019012"), (40_000, "0999999999"), (250_000, "0888888888"), (6000, "0123456789"))]
    with cursor() as cur:
        for d in seen:
            cur.execute("SELECT * FROM transactions WHERE id = ?", (d["transaction_id"],))
            row = dict(cur.fetchone())
            score, action = W.replay(json.loads(row["score_parts"]), row["channel"], row["institution_id"],
                                     active["params"])
            assert (score, action) == (row["risk_score"], row["action_taken"]) == (d["risk_score"], d["action"])


def test_engine_version_and_hash_are_written_on_every_decision(client):
    from core import engine_config
    from core.db import cursor

    d = _decide(client)
    assert d["engine_version"] == 1
    with cursor() as cur:
        cur.execute("SELECT engine_version, engine_params_hash, score_parts FROM transactions WHERE id = ?",
                    (d["transaction_id"],))
        row = cur.fetchone()
    assert row["engine_version"] == 1
    assert row["engine_params_hash"] == engine_config.active()["hash"]
    assert json.loads(row["score_parts"])["terms"]
    explained = client.get(f"/v1/shield/explanation/{d['transaction_id']}", headers=_bank_session())
    assert explained.status_code == 200 and explained.json()["engine_version"] == 1


def test_an_unchanged_draft_backtests_to_zero_changed_decisions(client):
    from services import backtest

    for _ in range(5):
        _decide(client)
    report = backtest.replay(_active_params(), 30)
    assert report["rows"]["replayed"] > 0
    assert report["overall"]["changed"] == 0
    assert report["warnings"] == []
    # Every row written with parts replays to what was decided.
    assert report["rows"]["exact"] > 0


# ── Bounds ───────────────────────────────────────────────────────────────────

@pytest.mark.parametrize("change", [
    {"weights.new_recipient": 0.09},            # below its floor
    {"weights.failed_verification_high": 0.10},  # below its floor
    {"weights.device_anomaly": 0.0},            # below its floor
    {"weights.velocity": 0.55},                 # above the maximum
    {"weights.time_anomaly": 0.30},             # a step of 0.18
    {"thresholds.ussd.flag": 0.75},             # flag within 0.1 of block
])
def test_bounds_floors_and_the_step_cap_are_enforced(client, change):
    r = _draft(client, change)
    assert r.status_code == 422, r.text


def test_drift_beyond_the_cap_needs_a_written_reason(client):
    from core.db import cursor

    # Version 1 is the 30-day reference. Two steps of 0.15 take live to 0.30 above it.
    for value in (0.27, 0.42):
        v = _approved_version(client, {"weights.time_anomaly": value})
        assert client.post(f"/operator/engine/versions/{v}/promote", headers=_op(OWNER_A),
                           json={"step_up": _code(OWNER_A)}).status_code == 200
    with cursor() as cur:
        cur.execute("UPDATE engine_activations SET started_at = datetime('now', '-40 days') WHERE version = 1")
    r = _draft(client, {"weights.time_anomaly": 0.45})  # a small step, but 0.33 from 30 days ago
    assert r.status_code == 200, r.text
    v = r.json()["version"]
    client.post(f"/operator/engine/versions/{v}/backtest", headers=_op(ADMIN), json={"days": 30})
    refused = client.post(f"/operator/engine/versions/{v}/propose", headers=_op(OWNER_A),
                          json={"step_up": _code(OWNER_A), "acknowledge_impact": True})
    assert refused.status_code == 422 and "reason" in refused.text
    ok = client.post(f"/operator/engine/versions/{v}/propose", headers=_op(OWNER_A),
                     json={"step_up": _code(OWNER_A), "acknowledge_impact": True,
                           "drift_note": "Night-time scams up sharply this quarter."})
    assert ok.status_code == 200, ok.text


# ── Propose and approve ──────────────────────────────────────────────────────

def test_proposing_needs_a_fresh_backtest_and_a_step_up(client):
    from core.db import cursor

    v = _draft(client, {"weights.time_anomaly": 0.13}).json()["version"]
    no_backtest = client.post(f"/operator/engine/versions/{v}/propose", headers=_op(OWNER_A),
                              json={"step_up": _code(OWNER_A)})
    assert no_backtest.status_code == 409
    client.post(f"/operator/engine/versions/{v}/backtest", headers=_op(ADMIN), json={"days": 30})
    assert client.post(f"/operator/engine/versions/{v}/propose", headers=_op(OWNER_A),
                       json={"step_up": {}}).status_code == 401
    assert client.post(f"/operator/engine/versions/{v}/propose", headers=_op(ADMIN),
                       json={"step_up": _code(ADMIN)}).status_code == 403
    with cursor() as cur:
        cur.execute("UPDATE engine_versions SET backtest_at = datetime('now', '-25 hours') WHERE version = ?", (v,))
    stale = client.post(f"/operator/engine/versions/{v}/propose", headers=_op(OWNER_A), json={"step_up": _code(OWNER_A)})
    assert stale.status_code == 409


def test_a_second_owner_approves_and_the_proposer_cannot(client):
    v = _draft(client, {"weights.time_anomaly": 0.13}).json()["version"]
    client.post(f"/operator/engine/versions/{v}/backtest", headers=_op(ADMIN), json={"days": 30})
    p = client.post(f"/operator/engine/versions/{v}/propose", headers=_op(OWNER_A), json={"step_up": _code(OWNER_A)})
    assert p.status_code == 200 and p.json()["status"] == "proposed"
    # Frozen: a proposed version cannot be edited.
    assert client.put(f"/operator/engine/versions/{v}", headers=_op(ADMIN),
                      json={"params": _active_params()}).status_code == 409
    assert client.post(f"/operator/engine/versions/{v}/approve", headers=_op(OWNER_A),
                       json={"step_up": _code(OWNER_A)}).status_code == 403
    a = client.post(f"/operator/engine/versions/{v}/approve", headers=_op(OWNER_B), json={"step_up": _code(OWNER_B)})
    assert a.status_code == 200, a.text
    body = a.json()
    assert body["status"] == "approved" and body["approved_by"] == OWNER_B
    assert body["approved_hash"] == body["params_hash"]


def test_one_owner_means_a_cooling_off_then_approval(client):
    from core.db import cursor
    from services import engine_admin

    with cursor() as cur:
        cur.execute("UPDATE operators SET role = 'platform_admin' WHERE email = ?", (OWNER_B,))
    v = _draft(client, {"weights.time_anomaly": 0.13}).json()["version"]
    client.post(f"/operator/engine/versions/{v}/backtest", headers=_op(ADMIN), json={"days": 30})
    p = client.post(f"/operator/engine/versions/{v}/propose", headers=_op(OWNER_A),
                    json={"step_up": _code(OWNER_A), "acknowledge_impact": True})
    assert p.json()["status"] == "cooling" and p.json()["apply_after"]
    engine_admin.sweep()
    assert engine_admin.status(v) == "cooling"
    with cursor() as cur:
        cur.execute("UPDATE engine_versions SET apply_after = datetime('now', '-1 minute') WHERE version = ?", (v,))
    engine_admin.sweep()
    assert engine_admin.status(v) == "approved"


def test_impact_warnings_must_be_acknowledged_by_the_approver(client):
    for _ in range(6):
        _insert(_fixed(0.70), action="FLAG")
    v = _draft(client, {"thresholds.mobile_app.block": 0.68, "thresholds.mobile_app.flag": 0.40}).json()["version"]
    report = client.post(f"/operator/engine/versions/{v}/backtest", headers=_op(ADMIN), json={"days": 30}).json()
    assert report["needs_ack"]
    client.post(f"/operator/engine/versions/{v}/propose", headers=_op(OWNER_A), json={"step_up": _code(OWNER_A)})
    refused = client.post(f"/operator/engine/versions/{v}/approve", headers=_op(OWNER_B), json={"step_up": _code(OWNER_B)})
    assert refused.status_code == 422
    ok = client.post(f"/operator/engine/versions/{v}/approve", headers=_op(OWNER_B),
                     json={"step_up": _code(OWNER_B), "acknowledge_impact": True})
    assert ok.status_code == 200 and ok.json()["impact_ack"] is True


# ── Frozen parameters ────────────────────────────────────────────────────────

def test_shadow_and_promote_refuse_parameters_that_no_longer_match(client):
    from core.db import cursor

    v = _approved_version(client)
    with cursor() as cur:
        cur.execute("SELECT params FROM engine_versions WHERE version = ?", (v,))
        params = json.loads(cur.fetchone()["params"])
        params["weights"]["velocity"] = 0.01
        cur.execute("UPDATE engine_versions SET params = ? WHERE version = ?", (json.dumps(params), v))
    assert client.post(f"/operator/engine/versions/{v}/shadow", headers=_op(OWNER_A),
                       json={"step_up": _code(OWNER_A), "days": 3}).status_code == 409
    assert client.post(f"/operator/engine/versions/{v}/promote", headers=_op(OWNER_A),
                       json={"step_up": _code(OWNER_A)}).status_code == 409


# ── Shadow ───────────────────────────────────────────────────────────────────

def test_shadow_never_changes_the_live_action_and_records_disagreements(client):
    from agents.shield import weights as W
    from core import engine_config
    from core.db import cursor

    base = _active_params()
    v = _approved_version(client, {
        "weights.new_recipient": round(base["weights"]["new_recipient"] + 0.15, 2),
        "thresholds.mobile_app.block": round(base["thresholds"]["mobile_app"]["block"] - 0.15, 2),
        "thresholds.mobile_app.flag": round(base["thresholds"]["mobile_app"]["flag"] - 0.15, 2)})
    r = client.post(f"/operator/engine/versions/{v}/shadow", headers=_op(OWNER_A),
                    json={"step_up": _code(OWNER_A), "days": 3})
    assert r.status_code == 200 and r.json()["status"] == "shadow"
    live = engine_config.active()
    assert live["version"] == 1
    seen = [_decide(client, amount=amount, account=f"07{i:08d}") for i, amount in enumerate((5000, 9000, 30_000, 60_000))]
    with cursor() as cur:
        for d in seen:
            cur.execute("SELECT * FROM transactions WHERE id = ?", (d["transaction_id"],))
            row = dict(cur.fetchone())
            _, live_action = W.replay(json.loads(row["score_parts"]), row["channel"], BANK, live["params"])
            assert d["action"] == row["action_taken"] == live_action
            assert d["engine_version"] == 1
            assert row["shadow_version"] == v and row["shadow_action"] in ("PASS", "FLAG", "BLOCK")
    diff = client.get("/operator/engine/shadow-diff", headers=_op(ADMIN)).json()
    assert diff["version"] == v and diff["scored"] >= len(seen)
    assert diff["disagreements"] >= 1


def test_a_failing_shadow_never_touches_the_decision(client, monkeypatch):
    from agents.shield import weights as W
    from core import engine_config
    from core.db import cursor
    from services import engine_admin

    v = _approved_version(client)
    client.post(f"/operator/engine/versions/{v}/shadow", headers=_op(OWNER_A), json={"step_up": _code(OWNER_A), "days": 3})

    def boom(*_a, **_k):
        raise RuntimeError("shadow exploded")

    monkeypatch.setattr(engine_admin, "record_shadow", boom)
    d = _decide(client, amount=7000, account="0555555555")
    assert d["engine_version"] == 1
    with cursor() as cur:
        cur.execute("SELECT * FROM transactions WHERE id = ?", (d["transaction_id"],))
        row = dict(cur.fetchone())
    # The response and the stored row are the live engine's verdict, untouched.
    score, action = W.replay(json.loads(row["score_parts"]), row["channel"], BANK, engine_config.active()["params"])
    assert (d["risk_score"], d["action"]) == (row["risk_score"], row["action_taken"]) == (score, action)
    assert row["shadow_action"] is None


# ── Promote and roll back ────────────────────────────────────────────────────

def test_promotion_is_live_at_once_and_rollback_restores_exactly(client):
    from core import engine_config

    original = engine_config.active()
    v = _approved_version(client)
    p = client.post(f"/operator/engine/versions/{v}/promote", headers=_op(OWNER_A), json={"step_up": _code(OWNER_A)})
    assert p.status_code == 200, p.text
    assert engine_config.active()["version"] == v
    assert _decide(client)["engine_version"] == v

    # Back to the version live just before: one owner, applied at once.
    r = client.post("/operator/engine/rollback", headers=_op(OWNER_A),
                    json={"version": 1, "reason": "Unexpected flag rate", "step_up": _code(OWNER_A)})
    assert r.status_code == 200, r.text
    restored = engine_config.active()
    assert restored["version"] == 1
    assert restored["params"] == original["params"] and restored["hash"] == original["hash"]


def test_rolling_back_further_goes_through_maker_checker(client):
    from core import engine_config

    original = engine_config.active()["params"]
    v2 = _approved_version(client, {"weights.time_anomaly": 0.13})
    client.post(f"/operator/engine/versions/{v2}/promote", headers=_op(OWNER_A), json={"step_up": _code(OWNER_A)})
    v3 = _approved_version(client, {"weights.time_anomaly": 0.14})
    client.post(f"/operator/engine/versions/{v3}/promote", headers=_op(OWNER_A), json={"step_up": _code(OWNER_A)})
    r = client.post("/operator/engine/rollback", headers=_op(OWNER_A),
                    json={"version": 1, "reason": "Back to the original", "step_up": _code(OWNER_A)})
    assert r.status_code == 200 and r.json()["status"] == "proposed" and r.json()["rollback_of"] == 1
    assert engine_config.active()["version"] == v3
    a = client.post(f"/operator/engine/versions/{r.json()['version']}/approve", headers=_op(OWNER_B),
                    json={"step_up": _code(OWNER_B), "acknowledge_impact": True})
    assert a.status_code == 200 and a.json()["status"] == "active"
    live = engine_config.active()
    assert live["version"] == r.json()["version"]
    assert live["params"] == original


# ── The environment wins ─────────────────────────────────────────────────────

def test_an_environment_value_wins_and_shows_as_managed_there(client, monkeypatch):
    from core import engine_config
    from services import backtest

    monkeypatch.setenv("FABLE_W_TIME_ANOMALY", "0.3")
    assert engine_config.active()["params"]["weights"]["time_anomaly"] == 0.3
    page = client.get("/operator/engine", headers=_op(ADMIN)).json()
    assert {"path": "weights.time_anomaly", "env": "FABLE_W_TIME_ANOMALY", "value": 0.3} in page["env_keys"]
    assert any(k["env"] == "FABLE_W_TIME_ANOMALY" for k in backtest.replay(_active_params(), 30)["env_keys"])


# ── An honest backtest ───────────────────────────────────────────────────────

def test_blocked_rows_without_a_label_are_no_outcome_and_labels_stay_apart(client):
    from services import backtest

    report_before = backtest.replay(_active_params(), 30, institution="honestbank")
    assert report_before["rows"]["replayed"] == 0
    _insert(_fixed(0.9), action="BLOCK", institution="honestbank")
    _insert(_fixed(0.9), action="BLOCK", institution="honestbank", outcome="fraud")
    _insert(_fixed(0.2), action="PASS", institution="honestbank", outcome="fraud")
    _insert(_fixed(0.6), action="FLAG", institution="honestbank", outcome="legitimate")
    _insert(_fixed(0.6), action="FLAG", institution="honestbank", status="cancelled")
    o = backtest.replay(_active_params(), 30, institution="honestbank")["outcomes"]
    assert o["no_outcome_blocked"] == 1
    assert o["fraud"]["n"] == 2 and o["fraud"]["missed_before"] == 1 and o["fraud"]["low_sample"]
    assert o["legitimate"]["n"] == 1
    assert o["ghost_cancelled"]["n"] == 1
    assert o["metrics_before"]["n"] == 3


def test_older_rows_are_rebuilt_from_their_signals_and_counted_approximate(client):
    from services import backtest

    _insert(None, ["new_recipient: first transfer to this account (+0.07)", "time_anomaly: outside hours",
                   "channel_risk: internet (+0.22)", "velocity: 4 transfers in 10m (+0.1)"],
            action="PASS", channel="internet", institution="legacybank")
    _insert(None, ["system_error: KeyError"], action="FLAG", institution="legacybank")
    report = backtest.replay(_active_params(), 30, institution="legacybank")
    assert report["rows"]["approximate"] == 1 and report["rows"]["skipped"] == 1
    assert report["overall"]["changed"] == 0


def test_a_spike_at_one_bank_raises_a_warning(client):
    from services import backtest

    for _ in range(8):
        _insert(_fixed(0.70), action="FLAG", institution="spikebank")
    params = _active_params()
    params["thresholds"]["mobile_app"].update(block=0.68, flag=0.40)
    report = backtest.replay(params, 30)
    assert any(w["kind"] == "bank_spike" and w["scope"] == "spikebank" for w in report["warnings"])
    assert report["needs_ack"]


def test_a_small_move_below_the_floor_raises_no_bank_warning():
    from services.backtest import _spike

    assert not _spike({"block_before": 1, "block_after": 3, "block_rate_before": 0.1, "block_rate_after": 0.3})
    assert _spike({"block_before": 10, "block_after": 15, "block_rate_before": 0.10, "block_rate_after": 0.15})


# ── The audit ────────────────────────────────────────────────────────────────

def test_every_step_is_in_the_audit_and_the_chain_holds(client):
    from core.db import cursor
    from services import secret_admin

    v = _approved_version(client)
    client.post(f"/operator/engine/versions/{v}/shadow", headers=_op(OWNER_A), json={"step_up": _code(OWNER_A), "days": 3})
    client.post(f"/operator/engine/versions/{v}/promote", headers=_op(OWNER_A), json={"step_up": _code(OWNER_A)})
    with cursor() as cur:
        cur.execute("SELECT event FROM secret_audit WHERE name = 'engine' AND version = ?", (v,))
        events = {r["event"] for r in cur.fetchall()}
    assert {"engine.draft_created", "engine.backtest_run", "engine.proposed", "engine.approved",
            "engine.shadow_started", "engine.shadow_ended", "engine.promoted"} <= events
    intact, _, broken = secret_admin.verify_chain()
    assert intact, broken


def test_another_process_sees_a_promotion_within_the_cache_window(client, monkeypatch):
    from core import engine_config
    from core.db import cursor

    assert engine_config.active()["version"] == 1
    v = _approved_version(client)
    # Another process: it promotes in the database, and this one has only its cache.
    with cursor() as cur:
        cur.execute("UPDATE engine_versions SET status = 'retired' WHERE version = 1")
        cur.execute("UPDATE engine_versions SET status = 'active' WHERE version = ?", (v,))
        cur.execute("UPDATE platform_settings SET value = 'elsewhere' WHERE key = 'engine.generation'")
    clock = [engine_config._cache["checked"] + 1]
    monkeypatch.setattr(engine_config.time, "monotonic", lambda: clock[0])
    assert engine_config.active()["version"] == 1          # still cached
    clock[0] += engine_config.CACHE_SECONDS + 1
    assert engine_config.active()["version"] == v          # picked up within 30 s


@pytest.mark.parametrize("name,value,ok", [
    ("FABLE_RATE_LIMIT_MAX", "180", True), ("FABLE_RATE_LIMIT_MAX", "10", False), ("FABLE_RATE_LIMIT_MAX", "5000", False),
    ("FABLE_RATE_LIMIT_WINDOW", "60", True), ("FABLE_EXPLAINER_TIMEOUT", "10", True), ("FABLE_EXPLAINER_TIMEOUT", "60", False),
])
def test_operational_settings_have_bounds(name, value, ok):
    from core import secrets as vault

    if ok:
        assert vault.parse_setting(vault.MANAGED[name], value) == int(value)
    else:
        with pytest.raises(ValueError):
            vault.parse_setting(vault.MANAGED[name], value)
