"""Lightweight unsupervised anomaly scoring using Isolation Forest.

Runs on [amount, hour_of_day] features from the user's own baseline
transactions. No training data or labels needed — Isolation Forest fits
on the fly per request. Contribution to the final score is capped so it
augments the deterministic rule layer rather than overriding it (the
demo must stay repeatable: the same inputs must always produce the same
action).
"""
import numpy as np
from sklearn.ensemble import IsolationForest

MAX_ML_CONTRIBUTION = 0.10
MIN_SAMPLES = 5


def score_anomaly(history_amounts: list[float], history_hours: list[int], amount: float, hour: int) -> float:
    """Returns a 0..MAX_ML_CONTRIBUTION boost based on how anomalous this
    transaction is relative to the user's own history."""
    if len(history_amounts) < MIN_SAMPLES:
        return 0.0

    X = np.array(list(zip(history_amounts, history_hours)), dtype=float)
    # n_estimators kept small — Shield has a sub-200ms latency budget and this
    # signal is only a small auxiliary boost on top of the deterministic rules
    model = IsolationForest(n_estimators=8, contamination=0.1, random_state=42)
    model.fit(X)

    sample = np.array([[amount, hour]], dtype=float)
    # decision_function: higher = more normal, lower/negative = more anomalous
    raw = model.decision_function(sample)[0]
    # squash into 0..1 anomaly-ness (raw typically in ~[-0.5, 0.5])
    anomaly_ness = float(np.clip(0.5 - raw, 0.0, 1.0))

    return round(anomaly_ness * MAX_ML_CONTRIBUTION, 4)
