"""Balance drain, and location judged by place instead of city name.

  * A transfer taking 80% or more of the available balance scores, more for
    the whole balance, and more again to a new recipient or from a new device.
    Below NGN 20,000, or with no balance known, it does not.
  * In the sandbox the balance comes from Fable's ledger, never from the
    request; a live bank may send balance_before.
  * "Lagos" and "Bariga" are one place: location compares distance from where
    the customer has been, and normalised names only without coordinates.
  * Both arrive through a governed draft: a version approved before them scores
    exactly as approved, and the draft changes nothing until promoted.
"""
import json
import os
import secrets
import sys
import tempfile

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
os.environ.setdefault("FABLE_DB_PATH", os.path.join(tempfile.mkdtemp(), "drain-place.db"))
os.environ.setdefault("FABLE_SESSION_SECRET", "test-secret")

IKEJA = (6.6018, 3.3515)
BARIGA = (6.5395, 3.3869)    # about 8 km from Ikeja
IBADAN = (7.3775, 3.9470)    # about 105 km from Ikeja


def _use(monkeypatch, params: dict) -> dict:
    from core import engine_config

    monkeypatch.setattr(engine_config, "active",
                        lambda: {"version": 99, "params": params, "hash": engine_config.params_hash(params)})
    monkeypatch.setattr(engine_config, "shadow", lambda: None)
    return params


@pytest.fixture
def recommended(monkeypatch):
    from core import engine_config

    return _use(monkeypatch, engine_config.code_defaults())


@pytest.fixture
def approved_before(monkeypatch):
    """A version approved before either change (production's v1)."""
    from core import engine_config

    legacy = json.loads(engine_config.canonical(engine_config.code_defaults()))
    for key in engine_config.LEGACY_FILL:
        legacy["weights"].pop(key)
    legacy["weights"]["location_city_large"], legacy["weights"]["location_city"] = 0.12, 0.06
    return _use(monkeypatch, engine_config.normalise(legacy))


def _settled_customer(city: str = "Ikeja", where: tuple = IKEJA) -> str:
    """A customer with settled history from one place, sending from one device."""
    from agents.copilot.baseline import log_transaction, record_location

    user = f"cus_place_{secrets.token_hex(4)}"
    ctx = {"city": city, "country": "Nigeria", "latitude": where[0], "longitude": where[1]}
    for i in range(6):
        log_transaction(user, f"txn_{secrets.token_hex(6)}",
                        {"amount": 20_000 + i * 1_000, "recipient_account": "0000000001", "channel": "mobile_app"},
                        "fp_home", 0.1, "LOW", "PASS", [], context=ctx, institution_id="placebank")
        record_location(user, ctx)
    return user


def _decide(user: str, amount: float, *, balance=None, where=IKEJA, city="Ikeja", account="0000000001",
            fingerprint="fp_home") -> dict:
    from agents.shield.analyzer import analyze_transaction

    txn = {"amount": amount, "recipient_account": account, "narration": "", "channel": "mobile_app"}
    if balance is not None:
        txn["balance_before"] = balance
    ctx = {"city": city, "country": "Nigeria", "latitude": where[0] if where else None,
           "longitude": where[1] if where else None}
    return analyze_transaction(user, txn, {"fingerprint_id": fingerprint}, ctx, institution_id="placebank")


def _signal(result: dict, name: str) -> str | None:
    return next((s for s in result["signals"] if s.startswith(name + ":")), None)


# ── Places ───────────────────────────────────────────────────────────────────

@pytest.mark.parametrize("name", ["Lagos", "lagos", "Lagos State", "Bariga", "Ikeja", "Lagos Island", "Eti-Osa",
                                  "Akowonjo"])
def test_lagos_districts_are_lagos(name):
    from agents.shield.places import normalise_city

    assert normalise_city(name) == "lagos"


def test_other_cities_stay_themselves():
    from agents.shield.places import normalise_city

    assert normalise_city("Ibadan") == "ibadan"
    assert normalise_city("Garki") == normalise_city("Abuja") == "abuja"
    assert normalise_city("Calabar") == "calabar"
    assert normalise_city(None) is None


def test_a_new_place_is_measured_by_distance_then_by_name():
    from agents.shield.places import new_place

    usual = [IKEJA]
    assert new_place(*BARIGA, "Bariga", usual, {"Ikeja"})[0] is False
    is_new, km = new_place(*IBADAN, "Ibadan", usual, {"Ikeja"})
    assert is_new and 95 < km < 115
    # No coordinates: names, normalised.
    assert new_place(None, None, "Lagos", [], {"Ikeja"}) == (False, None)
    assert new_place(None, None, "Calabar", [], {"Ikeja"}) == (True, None)
    # Nothing to compare: not evidence of a new place.
    assert new_place(None, None, "Calabar", [], set()) == (False, None)


def test_the_same_metro_under_another_name_is_not_a_new_city(recommended):
    user = _settled_customer()
    result = _decide(user, 21_000, where=BARIGA, city="Lagos")
    assert _signal(result, "location_anomaly") is None, result["signals"]


def test_a_far_place_is_new(recommended):
    user = _settled_customer()
    result = _decide(user, 21_000, where=IBADAN, city="Ibadan")
    assert "km from your usual places" in _signal(result, "location_anomaly")


def test_the_version_approved_before_keeps_judging_by_name(approved_before):
    """Production's v1: "new city Lagos" still fires, exactly as approved."""
    user = _settled_customer()
    result = _decide(user, 21_000, where=BARIGA, city="Lagos")
    assert _signal(result, "location_anomaly") == "location_anomaly: new city Lagos (+0.06)"


# ── Balance drain ────────────────────────────────────────────────────────────

def test_taking_most_of_the_balance_scores(recommended):
    user = _settled_customer()
    assert _signal(_decide(user, 85_000, balance=100_000), "balance_drain") == \
        "balance_drain: takes 85% of the available balance (+0.1)"
    assert _signal(_decide(user, 100_000, balance=100_000), "balance_drain") == \
        "balance_drain: takes the whole available balance (+0.16)"


def test_a_new_recipient_or_device_on_top_scores_more(recommended):
    user = _settled_customer()
    result = _decide(user, 100_000, balance=100_000, account="0999999999", fingerprint="fp_stranger")
    assert _signal(result, "balance_drain") == \
        "balance_drain: takes the whole available balance to a new recipient and from a new device (+0.26)"


@pytest.mark.parametrize("amount,balance", [(15_000, 15_000), (70_000, 100_000), (50_000, None), (50_000, 0)])
def test_no_drain_when_small_partial_or_unknown(recommended, amount, balance):
    user = _settled_customer()
    assert _signal(_decide(user, amount, balance=balance), "balance_drain") is None


def test_the_version_approved_before_scores_as_approved_but_records_the_drain(approved_before):
    from agents.shield.weights import replay
    from core import engine_config

    user = _settled_customer()
    result = _decide(user, 100_000, balance=100_000, account="0999999999")
    assert _signal(result, "balance_drain") is None
    # The term is recorded, so the draft's backtest and shadow can weigh it.
    keys = {k for t in result["score_parts"]["terms"] for k in t[0]}
    assert {"balance_drain_all", "balance_drain_combo"} <= keys
    score, _ = replay(result["score_parts"], "mobile_app", None, engine_config.code_defaults())
    assert score > result["risk_score"]


def test_the_drain_weights_must_rise_with_the_share():
    from core import engine_config

    bad = engine_config.code_defaults()
    bad["weights"]["balance_drain_all"] = 0.05
    assert any("whole balance" in e for e in engine_config.validate(bad))


# ── The sandbox reads the ledger ─────────────────────────────────────────────

def test_the_sandbox_uses_the_ledger_not_the_request(recommended):
    from fastapi.testclient import TestClient

    from core import customers, sessions
    from core.tenancy import register_institution
    from main import app
    from services import accounts as ledger

    register_institution("drainbank", "Drain Bank", "risk@drain.ng")
    ref = f"drain-{secrets.token_hex(3)}"
    user = customers.ensure("drainbank", ref, kind="test", source="console")["id"]
    ledger.ensure_account(user, "drainbank", opening_balance=500_000)
    session = {"X-Fable-Session": sessions.issue("owner@drainbank.ng", "drainbank")["token"]}
    res = TestClient(app).post("/v1/shield/analyze", headers=session, json={
        "user_id": user,
        # The browser claims a huge balance; the ledger says 500,000.
        "transaction": {"amount": 500_000, "recipient_account": "0123456789", "channel": "mobile_app",
                        "balance_before": 900_000_000},
    })
    assert res.status_code == 200, res.text
    assert any(s.startswith("balance_drain: takes the whole available balance") for s in res.json()["signals"])


# ── The governed draft ───────────────────────────────────────────────────────

def test_an_upgraded_deployment_gets_one_draft_and_nothing_goes_live():
    from core import engine_config
    from core.db import cursor

    legacy = json.loads(engine_config.canonical(engine_config.code_defaults()))
    for key in engine_config.DRAIN_PLACE_KEYS:
        legacy["weights"].pop(key)
    legacy["weights"]["location_city_large"], legacy["weights"]["location_city"] = 0.12, 0.06
    with cursor() as cur:
        cur.execute("DELETE FROM platform_settings WHERE key = ?", (engine_config.DRAIN_PLACE_DRAFT_FLAG,))
        # Versions other modules left on their way to going live would (rightly)
        # make the draft wait; set them aside for this test.
        pending = ("status IN ('proposed', 'cooling', 'approved', 'shadow') "
                   "OR (status = 'draft' AND created_by = 'system')")
        cur.execute(f"SELECT version, status FROM engine_versions WHERE {pending}")
        parked = [(r["version"], r["status"]) for r in cur.fetchall()]
        cur.execute(f"UPDATE engine_versions SET status = 'rejected' WHERE {pending}")
        cur.execute("SELECT version, params FROM engine_versions WHERE status = 'active'")
        active = cur.fetchone()
        if active is None:
            engine_config.seed_if_empty()
            cur.execute("SELECT version, params FROM engine_versions WHERE status = 'active'")
            active = cur.fetchone()
        original = active["params"]
        cur.execute("UPDATE engine_versions SET params = ? WHERE version = ?", (json.dumps(legacy), active["version"]))
    try:
        draft = engine_config.seed_drain_place_draft()
        assert draft is not None
        assert engine_config.seed_drain_place_draft() is None   # once only
        with cursor() as cur:
            cur.execute("SELECT status, params, base_version FROM engine_versions WHERE version = ?", (draft,))
            row = cur.fetchone()
        w = json.loads(row["params"])["weights"]
        assert row["status"] == "draft" and row["base_version"] == active["version"]
        assert (w["balance_drain_80"], w["balance_drain_all"], w["balance_drain_combo"]) == (0.10, 0.16, 0.10)
        assert (w["location_place_large"], w["location_place"]) == (0.12, 0.06)
        assert (w["location_city_large"], w["location_city"]) == (0.0, 0.0)
        # Only those changed, and the change passes the engine's own checks.
        base = engine_config.normalise(legacy)["weights"]
        moved = {k for k in w if abs(w[k] - base[k]) > 1e-9}
        assert moved == set(engine_config.DRAIN_PLACE_KEYS) | set(engine_config.DRAIN_PLACE_RETIRES)
        assert engine_config.validate(json.loads(row["params"]), legacy) == []
        with cursor() as cur:
            cur.execute("SELECT version FROM engine_versions WHERE status = 'active'")
            assert cur.fetchone()["version"] == active["version"]
    finally:
        with cursor() as cur:
            cur.execute("UPDATE engine_versions SET params = ? WHERE version = ?", (original, active["version"]))
            cur.execute("DELETE FROM engine_versions WHERE status = 'draft' AND created_by = 'system'")
            for version, status in parked:
                cur.execute("UPDATE engine_versions SET status = ? WHERE version = ?", (status, version))
