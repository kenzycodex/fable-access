"""The release draft carries two changes; the Engine page shows each one's effect.

  * Rows scored before the release lack the new terms. The backtest rebuilds
    them (first-transfer pricing from the amount and cold-start signal; the
    anomaly model from the customer's history before the decision) and counts
    them as rebuilt, without changing how they replay under the live values.
  * Each group of changes is replayed on its own: how many decisions it moves,
    in which direction, with examples.
  * The shadow comparison uses the same attribution on live decisions.
"""
import json
import os
import secrets
import sys
import tempfile
from datetime import datetime, timedelta, timezone

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
os.environ.setdefault("FABLE_DB_PATH", os.path.join(tempfile.mkdtemp(), "attribution.db"))
os.environ.setdefault("FABLE_SESSION_SECRET", "test-secret")

BANK = "attributionbank"


def _legacy():
    """A live version approved before the release's weights existed."""
    from core import engine_config

    stored = json.loads(engine_config.canonical(engine_config.code_defaults()))
    for key in engine_config.LEGACY_FILL:
        stored["weights"].pop(key)
    return engine_config.normalise(stored)


@pytest.fixture(scope="module")
def world():
    from fastapi.testclient import TestClient

    from core.tenancy import register_institution
    from main import app

    register_institution(BANK, "Attribution Bank", "risk@attribution.ng")
    TestClient(app)  # runs startup: schema, migrations, version 1
    return {}


@pytest.fixture
def legacy_live(world, monkeypatch):
    from core import engine_config

    for path in engine_config.env_overrides():   # values other test modules left in the environment
        monkeypatch.delenv(engine_config.env_name(path), raising=False)
    stored = _legacy()
    # As the real active() does: the server environment laid over the version.
    monkeypatch.setattr(engine_config, "active", lambda: {"version": 1, "params": engine_config.apply_env(stored),
                                                          "hash": "legacy", "stored": stored})
    return stored


def _when(days_ago: float) -> str:
    return (datetime.now(timezone.utc) - timedelta(days=days_ago)).strftime("%Y-%m-%dT%H:%M:%S")


def _decision(user: str, amount: float, hour: int, signals: list[str], terms: list, action: str) -> str:
    from core.db import cursor, dumps

    txid = f"txn_{secrets.token_hex(6)}"
    parts = {"v": 2, "terms": terms, "tenure": 0.0, "nip34": False}
    with cursor() as cur:
        cur.execute(
            """INSERT INTO transactions (id, user_id, amount, hour_of_day, channel, risk_score, action_taken,
                 shield_signals, score_parts, created_at, institution_id)
               VALUES (?, ?, ?, ?, 'mobile_app', 0.5, ?, ?, ?, ?, ?)""",
            (txid, user, amount, hour, action, dumps(signals), dumps(parts), _when(1), BANK),
        )
    return txid


def _history(user: str, n: int = 20) -> None:
    from core.db import cursor

    with cursor() as cur:
        for i in range(n):
            cur.execute(
                """INSERT INTO transactions (id, user_id, amount, hour_of_day, channel, action_taken,
                     confirmed_legitimate, is_seed, created_at, institution_id)
                   VALUES (?, ?, ?, ?, 'mobile_app', 'PASS', 1, 1, ?, ?)""",
                (f"txn_hist_{user}_{i}", user, 8_000 + 200 * i, 10 + i % 5, _when(10 + i), BANK),
            )


NEW_RECIPIENT = [{"new_recipient": 1}, 0.0, 1, 1]
CHANNEL = [{"channel_mobile_app": 1}, 0.0, 1, 0, 0.05]


def test_each_change_in_the_release_draft_is_shown_on_its_own(legacy_live):
    from core import engine_config
    from services import backtest

    # Scored before the release: a brand-new customer's NGN 900m first transfer
    # passed at 0.47 (cold start 0.15 + new recipient 0.20 + channel 0.12).
    first = _decision(f"new_{secrets.token_hex(3)}", 900_000_000, 12,
                      ["cold_start: no history for this customer or institution (+0.15)",
                       "new_recipient: first transfer to this account (+0.2)", "channel_risk: mobile_app (+0.12)"],
                      [[{}, 0.15, 1, 0], NEW_RECIPIENT, CHANNEL], "PASS")
    # An established customer's ordinary transfer, flagged only because the
    # previous anomaly model added points to it (0.2 + 0.12 + 0.12 + 0.045).
    regular = f"reg_{secrets.token_hex(3)}"
    _history(regular)
    anomaly = _decision(regular, 10_000, 12,
                        ["new_recipient: first transfer to this account (+0.2)", "time_anomaly: outside (device time)",
                         "channel_risk: mobile_app (+0.12)", "ml_anomaly: isolation forest deviation (+0.045)"],
                        [NEW_RECIPIENT, [{"time_anomaly": 1}, 0.0, 1, 0], CHANNEL, [{}, 0.045, 1, 0]], "FLAG")

    # The first release draft: no-history amounts and the anomaly model only
    # (balance drain and location by place are a later draft).
    draft = engine_config.code_defaults()
    for key in engine_config.DRAIN_PLACE_KEYS:
        draft["weights"][key] = 0.0
    report = backtest.replay(draft, 30, institution=BANK)
    assert report["rows"]["fidelity"] == report["rows"]["replayed"], "rebuilt terms replay as decided"
    assert report["rows"]["rebuilt"] >= 2
    groups = {g["group"]: g for g in report["by_change"]}
    assert set(groups) == {"First transfers (no history)", "Anomaly model"}

    first_amount = groups["First transfers (no history)"]
    assert first_amount["changed"] == 1 and first_amount["moves"] == {"PASS to BLOCK": 1}
    assert [e["id"] for e in first_amount["examples"]] == [first]
    assert first_amount["examples"][0]["after"] == "BLOCK"

    model = groups["Anomaly model"]
    assert model["changed"] == 1 and model["moves"] == {"FLAG to PASS": 1}
    assert [e["id"] for e in model["examples"]] == [anomaly]


def test_an_unchanged_draft_has_nothing_to_attribute(legacy_live):
    from services import backtest

    report = backtest.replay(legacy_live, 30, institution=BANK)
    assert report["by_change"] == [] and report["overall"]["changed"] == 0


def test_live_decisions_after_the_release_attribute_from_their_own_parts():
    """What the shadow comparison runs: parts recorded live carry both models."""
    from core import engine_config
    from services import backtest

    legacy, release = _legacy(), engine_config.code_defaults()
    parts = {"v": 2, "terms": [NEW_RECIPIENT, CHANNEL, [{}, 0.15, 1, 0],
                               [{"first_amount_20m": 1.0}, 0.0, 1, 1],
                               [{"ml_anomaly": 0.0, "ml_anomaly_previous": 0.1}, 0.0, 1, 0, 0.02]],
             "tenure": 0.0, "nip34": False}
    rows = [{"id": "t1", "institution_id": BANK, "channel": "mobile_app", "amount": 900_000_000, "parts": parts}]
    groups = {g["group"]: g for g in backtest.attribute(rows, legacy, release)}
    assert groups["First transfers (no history)"]["changed"] == 1
    assert groups["Anomaly model"]["changed"] == 0
