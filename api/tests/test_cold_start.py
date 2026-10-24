"""A customer with no history can no longer move any sum unchallenged.

Before the no-history amount weights, a new customer at a new bank scored a
flat 0.47 on the mobile app or USSD whatever the amount (cold start 0.15, new
recipient 0.20, channel 0.12), just under the flag line, so a first transfer of
NGN 900 million passed. The weights arrive through a governed engine version,
so an existing deployment's active version keeps scoring as approved until an
operator promotes the prepared draft.
"""
import json
import os
import sys
import tempfile

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
os.environ.setdefault("FABLE_DB_PATH", os.path.join(tempfile.mkdtemp(), "cold-start.db"))
os.environ.setdefault("FABLE_SESSION_SECRET", "test-secret")

_n = [0]


def _score(amount: float, channel: str, params: dict | None = None, monkeypatch=None) -> dict:
    """A brand-new customer at a bank with no history."""
    from agents.shield.analyzer import analyze_transaction

    _n[0] += 1
    return analyze_transaction(
        f"cus_cold_{_n[0]}",
        {"amount": amount, "recipient_account": f"01234{_n[0]:05d}", "narration": "", "channel": channel},
        {}, {}, institution_id=f"coldbank_{_n[0]}",
    )


@pytest.fixture
def recommended(monkeypatch):
    """Score under the recommended parameters, whatever version the shared test
    database has active."""
    from core import engine_config

    # Code defaults exactly: other test modules set FABLE_W_* in the environment.
    p = engine_config.code_defaults()
    monkeypatch.setattr(engine_config, "active",
                        lambda: {"version": 99, "params": p, "hash": engine_config.params_hash(p)})
    return p


@pytest.mark.parametrize("channel", ["mobile_app", "ussd", "atm", "branch"])
def test_a_small_first_transfer_passes(recommended, channel):
    assert _score(5_000, channel)["action"] == "PASS"


@pytest.mark.parametrize("channel", ["mobile_app", "ussd", "internet", "pos", "atm"])
def test_a_large_first_transfer_is_flagged(recommended, channel):
    result = _score(200_000, channel)
    assert result["action"] in ("FLAG", "BLOCK"), result
    assert any(s.startswith("first_transfer_amount") for s in result["signals"])


@pytest.mark.parametrize("channel", ["mobile_app", "ussd", "internet", "pos", "atm"])
@pytest.mark.parametrize("amount", [50_000_000, 900_000_000])
def test_a_huge_first_transfer_is_blocked(recommended, channel, amount):
    assert _score(amount, channel)["action"] == "BLOCK"


def test_branch_gets_room_but_never_passes_a_huge_first_transfer(recommended):
    """A teller sees the customer in person, so a branch transfer is given more
    room, but NGN 50 million with no history still needs a check."""
    assert _score(50_000_000, "branch")["action"] in ("FLAG", "BLOCK")


def test_the_decision_replays_exactly(recommended):
    from agents.shield.weights import replay

    result = _score(7_500_000, "mobile_app")
    score, action = replay(result["score_parts"], "mobile_app", None, recommended)
    assert score == result["risk_score"] and action == result["action"]


def test_a_version_approved_before_the_weights_existed_scores_as_approved(monkeypatch):
    """Shipping the code changes no decision: the old version reads the new
    weights as zero until a governed version sets them."""
    from core import engine_config

    legacy = json.loads(engine_config.canonical(engine_config.code_defaults()))
    for key in engine_config.LEGACY_FILL:
        legacy["weights"].pop(key)
    p = engine_config.normalise(legacy)
    assert all(p["weights"][k] == engine_config.LEGACY_FILL[k] for k in engine_config.LEGACY_FILL)
    monkeypatch.setattr(engine_config, "active",
                        lambda: {"version": 1, "params": p, "hash": engine_config.params_hash(p)})
    result = _score(900_000_000, "mobile_app")
    assert result["risk_score"] == 0.47 and result["action"] == "PASS"


def test_introducing_the_weights_is_not_held_to_the_step_limit():
    from core import engine_config

    legacy = json.loads(engine_config.canonical(engine_config.code_defaults()))
    for key in engine_config.LEGACY_FILL:
        legacy["weights"].pop(key)
    assert engine_config.validate(engine_config.code_defaults(), legacy) == []
    # Once present, the limit applies as usual.
    moved = engine_config.code_defaults()
    moved["weights"]["first_amount_20m"] = 0.10
    assert engine_config.validate(moved, engine_config.code_defaults())


def test_the_weights_must_not_fall_as_the_amount_rises():
    from core import engine_config

    bad = engine_config.code_defaults()
    bad["weights"]["first_amount_5m"] = 0.50
    assert any("must not fall" in e for e in engine_config.validate(bad))


def test_an_upgraded_deployment_gets_a_draft_once_and_nothing_goes_live():
    from core import engine_config
    from core.db import cursor

    legacy = json.loads(engine_config.canonical(engine_config.code_defaults()))
    for key in engine_config.LEGACY_FILL:
        legacy["weights"].pop(key)
    with cursor() as cur:
        cur.execute("DELETE FROM platform_settings WHERE key = ?", (engine_config.COLD_START_DRAFT_FLAG,))
        cur.execute("SELECT version, params FROM engine_versions WHERE status = 'active'")
        active = cur.fetchone()
        if active is None:
            engine_config.seed_if_empty()
            cur.execute("SELECT version, params FROM engine_versions WHERE status = 'active'")
            active = cur.fetchone()
        original = active["params"]
        cur.execute("UPDATE engine_versions SET params = ? WHERE version = ?",
                    (json.dumps(legacy), active["version"]))
    try:
        draft = engine_config.seed_cold_start_draft()
        assert draft is not None
        assert engine_config.seed_cold_start_draft() is None   # once only
        with cursor() as cur:
            cur.execute("SELECT status, params FROM engine_versions WHERE version = ?", (draft,))
            row = cur.fetchone()
        assert row["status"] == "draft"
        assert json.loads(row["params"])["weights"]["first_amount_20m"] == 0.45
        with cursor() as cur:
            cur.execute("SELECT version FROM engine_versions WHERE status = 'active'")
            assert cur.fetchone()["version"] == active["version"]
    finally:
        with cursor() as cur:
            cur.execute("UPDATE engine_versions SET params = ? WHERE version = ?", (original, active["version"]))
            cur.execute("DELETE FROM engine_versions WHERE status = 'draft' AND created_by = 'system'")


def test_the_engine_page_says_when_first_transfers_are_not_priced():
    import json as _json

    from core import engine_config
    from services import engine_admin

    legacy = _json.loads(engine_config.canonical(engine_config.code_defaults()))
    for key in engine_config.LEGACY_FILL:
        legacy["weights"].pop(key)
    draft = {"version": 9, "status": "draft", "params": engine_config.code_defaults()}
    status = engine_admin.cold_start_status({"params": legacy}, [draft])
    assert status == {"live": False, "waiting": [{"version": 9, "status": "draft"}]}
    assert engine_admin.cold_start_status({"params": engine_config.code_defaults()}, [])["live"] is True
