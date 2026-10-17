"""The anomaly signal, reworked under a governed version.

  * A typical transfer adds nothing under the current model; under the
    previous one it added points to almost every transfer.
  * A forest is reused only for the exact history it was fitted on.
  * The current model does not depend on the order history rows arrive in.
  * A version approved before the anomaly weights keeps the previous model;
    new versions use the current one.
"""
import os
import random
import sys
import tempfile

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
os.environ.setdefault("FABLE_DB_PATH", os.path.join(tempfile.mkdtemp(), "anomaly.db"))
os.environ.setdefault("FABLE_SESSION_SECRET", "test-secret")


def _salaried(n=40, seed=1):
    rng = random.Random(seed)
    return [rng.uniform(5_000, 40_000) for _ in range(n)], [rng.choice(range(9, 18)) for _ in range(n)]


def test_a_typical_transfer_adds_nothing_under_the_current_model():
    from agents.shield.anomaly import MAX_ML_CONTRIBUTION, current_anomaly, previous_anomaly

    amounts, hours = _salaried()
    assert current_anomaly(amounts, hours, 20_000, 13) == 0.0
    # The previous model scored the same transfer above the 0.02 gate.
    assert previous_anomaly(amounts, hours, 20_000, 13) * MAX_ML_CONTRIBUTION > 0.02


def test_an_amount_usual_at_one_time_of_day_stands_out_at_another():
    from agents.shield.anomaly import current_anomaly

    # Small transfers in the morning, large ones in the evening.
    rng = random.Random(3)
    amounts = [rng.uniform(2_000, 5_000) for _ in range(30)] + [rng.uniform(50_000, 100_000) for _ in range(30)]
    hours = [rng.choice((8, 9, 10)) for _ in range(30)] + [rng.choice((18, 19, 20)) for _ in range(30)]
    assert current_anomaly(amounts, hours, 80_000, 19) == 0.0
    assert current_anomaly(amounts, hours, 80_000, 9) > 0.2


def test_a_forest_is_reused_only_for_the_same_history():
    from agents.shield import anomaly

    amounts, hours = _salaried()
    first = anomaly.current_anomaly(amounts, hours, 20_000, 3, cache_key="same-count")
    # Same number of rows, different rows: the window slid. The old cache,
    # keyed by the count, answered this from the first forest.
    shifted = [a * 10 for a in amounts]
    second = anomaly.current_anomaly(shifted, hours, 20_000, 3, cache_key="same-count")
    fresh = anomaly.current_anomaly(shifted, hours, 20_000, 3)
    assert second == fresh and second != first


def test_row_order_does_not_change_the_current_model():
    from agents.shield.anomaly import current_anomaly

    amounts, hours = _salaried()
    pairs = list(zip(amounts, hours))
    random.Random(5).shuffle(pairs)
    shuffled_a, shuffled_h = [a for a, _ in pairs], [h for _, h in pairs]
    assert current_anomaly(amounts, hours, 30_000, 22) == current_anomaly(shuffled_a, shuffled_h, 30_000, 22)


def test_old_versions_keep_the_previous_model_and_new_ones_use_the_current():
    import json

    from core import engine_config

    legacy = json.loads(engine_config.canonical(engine_config.code_defaults()))
    for key in ("ml_anomaly", "ml_anomaly_previous"):
        legacy["weights"].pop(key)
    old = engine_config.normalise(legacy)["weights"]
    assert old["ml_anomaly_previous"] == 0.10 and old["ml_anomaly"] == 0.0
    new = engine_config.code_defaults()["weights"]
    assert new["ml_anomaly_previous"] == 0.0 and new["ml_anomaly"] == 0.10
    # Switching models is an introduction, not a step: allowed in one version.
    assert engine_config.validate(engine_config.code_defaults(), legacy) == []


def test_the_previous_model_boost_replays_exactly():
    from agents.shield.anomaly import score_anomaly
    from agents.shield.weights import term, term_value

    amounts, hours = _salaried()
    boost = score_anomaly(amounts, hours, 20_000, 13)
    from agents.shield.anomaly import previous_anomaly

    t = term({"ml_anomaly_previous": previous_anomaly(amounts, hours, 20_000, 13)}, gate=0.02)
    assert abs(term_value(t, {"ml_anomaly_previous": 0.10}) - boost) < 1e-9
    assert term_value(t, {"ml_anomaly_previous": 0.0}) == 0.0


def test_baseline_windows_read_every_timestamp_form():
    """A row written by SQLite with a space ("2026-10-16 12:00:00") on the
    cutoff day used to compare as older than the cutoff ("2026-10-16T...")."""
    import secrets
    from datetime import timedelta

    from agents.copilot.baseline import get_user_history_arrays
    from core.db import cursor
    from core.utils import utcnow

    user = f"ts_{secrets.token_hex(4)}"
    inside = utcnow() - timedelta(days=90) + timedelta(hours=1)   # just inside the window
    with cursor() as cur:
        for i, ts in enumerate((inside.strftime("%Y-%m-%d %H:%M:%S"), inside.isoformat(),
                                inside.isoformat() + "+00:00")):
            cur.execute("INSERT INTO transactions (id, user_id, amount, hour_of_day, confirmed_legitimate, "
                        "created_at) VALUES (?, ?, 1000, 10, 1, ?)", (f"txn_ts_{user}_{i}", user, ts))
    amounts, _ = get_user_history_arrays(user)
    assert len(amounts) == 3
