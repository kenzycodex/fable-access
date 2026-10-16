"""Unsupervised anomaly scoring on the customer's own confirmed history.

Two models live here, and an engine version chooses between them through two
weights (see engine_config, "Anomaly model"):

  previous  An Isolation Forest on [amount, hour] as raw numbers, 8 trees,
            mapped so that even a typical transfer scored above the engine's
            0.02 gate: on simulated customers it added points to every typical
            transfer. Kept unchanged so a version approved under it replays
            exactly.

  current   Nearest neighbours in the customer's own history. Each transfer is
            a point (log amount, hour of day); the distance between two points
            treats a 1.65x change in amount like a 3-hour change in time, and
            reads the clock as a circle, so 23:00 and 01:00 are two hours
            apart. A transfer's distance to its 3rd-nearest past transfer is
            compared with the same distance for the customer's own transfers:
            within their usual spread it scores 0, and it reaches 1 at three
            times that spread.

Why not a reworked Isolation Forest: a forest only splits inside the range it
was fitted on, so it cannot isolate an amount or hour outside that range, and
its axis-aligned splits missed the combination that matters (an amount the
customer sends in the evening, sent in the morning). On simulated customers a
tuned forest still scored about 7% of typical transfers and missed most odd
ones; the nearest-neighbour model scored 0.5% of typical transfers and caught
the odd ones. It is deterministic, needs no training labels, and every number
in it can be explained.

Each model returns an "anomaly-ness" between 0 and 1; the engine weight turns it
into score points, so a backtest can replay a stored decision under any weights.

Fitted state is cached per customer, keyed by a hash of the exact history it
was fitted on. The previous cache was keyed by the number of samples, so a
90-day window that dropped one old transfer and gained one new one kept
answering from a model fitted on different data.
"""
from __future__ import annotations

import hashlib
import threading

import numpy as np
from sklearn.ensemble import IsolationForest

# The previous model's maximum contribution, kept for callers and tests that
# still ask for a boost rather than an anomaly-ness.
MAX_ML_CONTRIBUTION = 0.10
MIN_SAMPLES = 5                  # previous model
MIN_SAMPLES_CURRENT = 8          # current model: fewer points have no usual spread
NEIGHBOUR = 3                    # distance to the 3rd-nearest past transfer
AMOUNT_SCALE = 0.5               # log-amount units per distance unit (about 1.65x)
HOUR_SCALE = 3.0                 # hours per distance unit
OWN_QUANTILE = 0.95              # "usual spread" = the customer's own 95th percentile
MIN_SPREAD = 0.5                 # never treat a very regular customer as having no spread
MAX_HISTORY = 500                # an even sample of a longer history; bounds the cost

CACHE_MAX_USERS = 512
_cache: dict[str, tuple[str, object]] = {}
_cache_lock = threading.Lock()


def _history_key(model: str, amounts: list[float], hours: list[int]) -> str:
    h = hashlib.sha1(model.encode())
    for a, hr in zip(amounts, hours):
        h.update(f"{float(a):.2f}:{int(hr)};".encode())
    return h.hexdigest()


def _cached(cache_key: str | None, model: str, amounts: list[float], hours: list[int], fit):
    if cache_key is None:
        return fit(amounts, hours)
    digest = _history_key(model, amounts, hours)
    slot = f"{model}:{cache_key}"
    with _cache_lock:
        cached = _cache.get(slot)
        if cached and cached[0] == digest:
            return cached[1]
    # Fit outside the lock: a slow fit for one customer must not stall others.
    fitted = fit(amounts, hours)
    with _cache_lock:
        if len(_cache) >= CACHE_MAX_USERS and slot not in _cache:
            _cache.pop(next(iter(_cache)), None)
        _cache[slot] = (digest, fitted)
    return fitted


# ── Previous model (kept for versions approved under it) ─────────────────────

def _fit_previous(amounts: list[float], hours: list[int]) -> IsolationForest:
    X = np.array(list(zip(amounts, hours)), dtype=float)
    model = IsolationForest(n_estimators=8, contamination=0.1, random_state=42)
    model.fit(X)
    return model


def previous_anomaly(amounts: list[float], hours: list[int], amount: float, hour: int,
                     cache_key: str | None = None) -> float:
    """The previous model's anomaly-ness, 0..1. Its boost was this times 0.10."""
    if len(amounts) < MIN_SAMPLES:
        return 0.0
    # Rows in database order, as the previous model always fitted them.
    model = _cached(cache_key, "previous", amounts, hours, _fit_previous)
    raw = model.decision_function(np.array([[amount, hour]], dtype=float))[0]
    return round(float(np.clip(0.5 - raw, 0.0, 1.0)) * MAX_ML_CONTRIBUTION, 4) / MAX_ML_CONTRIBUTION


def score_anomaly(amounts: list[float], hours: list[int], amount: float, hour: int,
                  cache_key: str | None = None) -> float:
    """The previous model's boost, 0..MAX_ML_CONTRIBUTION."""
    return round(previous_anomaly(amounts, hours, amount, hour, cache_key) * MAX_ML_CONTRIBUTION, 4)


# ── Current model ────────────────────────────────────────────────────────────

def _points(amounts, hours) -> np.ndarray:
    return np.column_stack([np.log1p(np.maximum(np.asarray(amounts, dtype=float), 0.0)),
                            np.asarray(hours, dtype=float) % 24])


def _distances(a: np.ndarray, b: np.ndarray) -> np.ndarray:
    """Pairwise distances between rows of a and rows of b."""
    da = (a[:, None, 0] - b[None, :, 0]) / AMOUNT_SCALE
    dh = np.abs(a[:, None, 1] - b[None, :, 1]) % 24
    dh = np.minimum(dh, 24 - dh) / HOUR_SCALE
    return np.sqrt(da * da + dh * dh)


def _fit_current(amounts: list[float], hours: list[int]) -> tuple[np.ndarray, float]:
    """The customer's points and their usual spread."""
    points = _points(amounts, hours)
    d = _distances(points, points)
    np.fill_diagonal(d, np.inf)
    own = np.sort(d, axis=1)[:, NEIGHBOUR - 1]
    spread = max(float(np.quantile(own, OWN_QUANTILE)), MIN_SPREAD)
    return points, spread


def current_anomaly(amounts: list[float], hours: list[int], amount: float, hour: int,
                    cache_key: str | None = None) -> float:
    """How far this transfer sits from the customer's own transfers, 0..1.
    A transfer like the ones they usually make scores 0.

    The result does not depend on the order of the history."""
    if len(amounts) < MIN_SAMPLES_CURRENT:
        return 0.0
    pairs = sorted(zip((float(a) for a in amounts), (int(h) for h in hours)))
    if len(pairs) > MAX_HISTORY:
        step = len(pairs) / MAX_HISTORY
        pairs = [pairs[int(i * step)] for i in range(MAX_HISTORY)]
    amounts, hours = [a for a, _ in pairs], [h for _, h in pairs]
    points, spread = _cached(cache_key, "current", amounts, hours, _fit_current)
    d = np.sort(_distances(_points([amount], [hour]), points)[0])[NEIGHBOUR - 1]
    return round(float(np.clip((d - spread) / (2 * spread), 0.0, 1.0)), 4)
