"""Shield's signal weights and per-channel decision thresholds, in one place.

These were scattered through the analyzer as inline magic numbers, which made
the engine impossible to tune without editing scoring logic and easy to
misdescribe. Centralising them is what lets the weights be honestly called
*configurable*: an institution can adjust a number here (or via env) without
touching how signals fire.

What these are NOT: weights learned from a labelled fraud dataset. They are
grounded in published NIBSS/CBN channel fraud statistics and documented
Nigerian scam patterns, and they are explainable by construction. The
eval harness (`api/eval/`) is where measured calibration would happen once an
institution supplies labelled outcomes; until then, claiming a trained model
would be a fabrication, so we don't.
"""
import os


def _f(name: str, default: float) -> float:
    """A weight, overridable by env (FABLE_W_<NAME>) for per-deployment tuning."""
    try:
        return float(os.getenv(f"FABLE_W_{name.upper()}", default))
    except ValueError:
        return default


# --- Per-signal weights ----------------------------------------------------
# Amount anomaly is progressive: the multiple of the user's baseline decides
# the tier, so a 45x spike outweighs a milder 6x one instead of capping out.
AMOUNT_ANOMALY = {
    50: _f("amount_50x", 0.40),
    25: _f("amount_25x", 0.34),
    10: _f("amount_10x", 0.28),
    5: _f("amount_5x", 0.20),
    0: _f("amount_3x", 0.15),  # > 3x baseline but under 5x
}

WEIGHTS = {
    "new_recipient": _f("new_recipient", 0.20),
    "time_anomaly": _f("time_anomaly", 0.12),
    "device_anomaly_large": _f("device_anomaly_large", 0.18),
    "device_anomaly": _f("device_anomaly", 0.08),
    "location_country": _f("location_country", 0.22),
    "location_city_large": _f("location_city_large", 0.12),
    "location_city": _f("location_city", 0.06),
    "session_freshness": _f("session_freshness", 0.12),
    "behavioral_paste": _f("behavioral_paste", 0.06),
    "behavioral_fast": _f("behavioral_fast", 0.09),
    "failed_verification_high": _f("failed_verification_high", 0.25),
    "failed_verification_large": _f("failed_verification_large", 0.15),
    "failed_verification": _f("failed_verification", 0.08),
    "timezone_mismatch": _f("timezone_mismatch", 0.08),
    # Velocity: several transfers from one customer inside a short window is a
    # classic drain/mule pattern. Uses data we already record (transaction
    # timestamps), so it is a real signal, not a placeholder.
    "velocity_high": _f("velocity_high", 0.20),
    "velocity": _f("velocity", 0.10),
}

# How many transfers within VELOCITY_WINDOW_MINUTES count as a burst.
VELOCITY_WINDOW_MINUTES = int(os.getenv("FABLE_VELOCITY_WINDOW_MIN", "10"))
VELOCITY_FLAG_COUNT = int(os.getenv("FABLE_VELOCITY_FLAG", "3"))
VELOCITY_HIGH_COUNT = int(os.getenv("FABLE_VELOCITY_HIGH", "5"))


def amount_anomaly_boost(multiplier: float) -> tuple[float, int]:
    """Return (boost, tier) for how far a transfer sits above the baseline."""
    for tier in (50, 25, 10, 5):
        if multiplier >= tier:
            return AMOUNT_ANOMALY[tier], tier
    return AMOUNT_ANOMALY[0], 0


# --- Per-channel decision thresholds ---------------------------------------
# The cutoff for FLAG/BLOCK is not universal: the same score means more on a
# riskier rail. USSD and internet — the channels NIBSS ties to the most loss —
# trip sooner; an in-person branch transfer is given more room. A card-not-
# present, an NIP payout and a USSD push should never share one boundary.
#
# Every cutoff is env-overridable: FABLE_THRESHOLD_<CHANNEL>_<BLOCK|FLAG>
# (e.g. FABLE_THRESHOLD_USSD_BLOCK=0.72), and the fallback default is
# FABLE_BLOCK_THRESHOLD / FABLE_FLAG_THRESHOLD, shared with config.py.
_DEFAULT_BLOCK = float(os.getenv("FABLE_BLOCK_THRESHOLD", "0.80"))
_DEFAULT_FLAG = float(os.getenv("FABLE_FLAG_THRESHOLD", "0.50"))
_DEFAULT_THRESHOLD = {"block": _DEFAULT_BLOCK, "flag": _DEFAULT_FLAG}

_CHANNEL_DEFAULTS = {
    "ussd": (0.75, 0.45),
    "internet": (0.75, 0.45),
    "pos": (0.78, 0.48),
    "atm": (0.78, 0.48),
    "mobile_app": (0.80, 0.50),
    "qr": (0.80, 0.50),
    "branch": (0.85, 0.55),
}


def _channel_threshold(channel: str, block_default: float, flag_default: float) -> dict:
    return {
        "block": float(os.getenv(f"FABLE_THRESHOLD_{channel.upper()}_BLOCK", block_default)),
        "flag": float(os.getenv(f"FABLE_THRESHOLD_{channel.upper()}_FLAG", flag_default)),
    }


CHANNEL_THRESHOLDS = {
    channel: _channel_threshold(channel, blk, flg)
    for channel, (blk, flg) in _CHANNEL_DEFAULTS.items()
}


def thresholds_for(channel: str | None) -> dict:
    """The (block, flag) cutoffs for a channel, falling back to the default."""
    return CHANNEL_THRESHOLDS.get(channel or "", _DEFAULT_THRESHOLD)
