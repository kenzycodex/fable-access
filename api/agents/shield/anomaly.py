"""Lightweight unsupervised anomaly scoring using Isolation Forest.

Runs on [amount, hour_of_day] features from the user's own baseline
transactions. No training data or labels needed — Isolation Forest fits
on the fly per request. Contribution to the final score is capped so it
augments the deterministic rule layer rather than overriding it (the
demo must stay repeatable: the same inputs must always produce the same
action).
"""
import threading

import numpy as np
from sklearn.ensemble import IsolationForest

MAX_ML_CONTRIBUTION = 0.10
MIN_SAMPLES = 5

# Fitting cost is dominated by sklearn's fixed overhead — roughly 23ms at ten
# samples and still only 43ms at five thousand — so it was the single largest
# item in a ~50ms decision, refitted from scratch on every request even when
# the history it fits had not changed at all.
#
# Forests are cached per user and reused until the history actually moves. The
# key includes the sample count, so the next transaction a customer makes
# invalidates their forest and it refits with that transaction included: the
# model still tracks behaviour continuously, it just stops rebuilding an
# identical model to answer an identical question.
_forest_cache: dict[str, tuple[int, IsolationForest]] = {}
_forest_lock = threading.Lock()
CACHE_MAX_USERS = 512


def _fit_forest(history_amounts: list[float], history_hours: list[int]) -> IsolationForest:
    X = np.array(list(zip(history_amounts, history_hours)), dtype=float)
    # n_estimators kept small — Shield has a sub-200ms latency budget and this
    # signal is only a small auxiliary boost on top of the deterministic rules
    model = IsolationForest(n_estimators=8, contamination=0.1, random_state=42)
    model.fit(X)
    return model


def _get_forest(cache_key: str | None, history_amounts: list[float], history_hours: list[int]) -> IsolationForest:
    if cache_key is None:
        return _fit_forest(history_amounts, history_hours)

    generation = len(history_amounts)
    with _forest_lock:
        cached = _forest_cache.get(cache_key)
        if cached and cached[0] == generation:
            return cached[1]

    # Fit outside the lock: a slow fit for one customer must not stall others.
    model = _fit_forest(history_amounts, history_hours)

    with _forest_lock:
        if len(_forest_cache) >= CACHE_MAX_USERS and cache_key not in _forest_cache:
            _forest_cache.pop(next(iter(_forest_cache)), None)
        _forest_cache[cache_key] = (generation, model)
    return model


def score_anomaly(
    history_amounts: list[float],
    history_hours: list[int],
    amount: float,
    hour: int,
    cache_key: str | None = None,
) -> float:
    """Returns a 0..MAX_ML_CONTRIBUTION boost based on how anomalous this
    transaction is relative to the user's own history.

    `cache_key` (the user id) enables forest reuse. Omitting it always refits,
    which keeps callers outside the request path — scripts, tests — unchanged.
    """
    if len(history_amounts) < MIN_SAMPLES:
        return 0.0

    model = _get_forest(cache_key, history_amounts, history_hours)

    sample = np.array([[amount, hour]], dtype=float)
    # decision_function: higher = more normal, lower/negative = more anomalous
    raw = model.decision_function(sample)[0]
    # squash into 0..1 anomaly-ness (raw typically in ~[-0.5, 0.5])
    anomaly_ness = float(np.clip(0.5 - raw, 0.0, 1.0))

    return round(anomaly_ness * MAX_ML_CONTRIBUTION, 4)
