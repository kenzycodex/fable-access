"""Shield's signal weights and per-channel decision thresholds, in one place.

These were scattered through the analyzer as inline magic numbers, which made
the engine impossible to tune without editing scoring logic and easy to
misdescribe. Centralising them is what lets the weights be honestly called
*configurable*: the values live in versioned, approved engine parameters
(core/engine_config.py, changed from the operator console's Engine page, with
the server environment still winning) and are read on every decision, so a
promotion takes effect without a restart or touching how signals fire.

Every decision also records *how* its score was built (score parts): which
weight each signal used and by what coefficient, plus the fixed contributions.
The live engine and the backtest add those parts with the same function here,
so re-scoring a stored decision under other weights is exact by construction.

What these are NOT: weights learned from a labelled fraud dataset. They are
grounded in published NIBSS/CBN channel fraud statistics and documented
Nigerian scam patterns, and they are explainable by construction. The
eval harness (`api/eval/`) is where measured calibration would happen once an
institution supplies labelled outcomes; until then, claiming a trained model
would be a fabrication, so we don't.
"""
import os

from core import engine_config


def params() -> dict:
    """The parameters in force: the active version, the environment over it."""
    return engine_config.current_params()


def weights(p: dict | None = None) -> dict:
    return (p or params())["weights"]


# How many transfers within VELOCITY_WINDOW_MINUTES count as a burst. These
# change *whether* a signal fires, so they stay in the environment: a past
# decision cannot be replayed exactly under a different window.
VELOCITY_WINDOW_MINUTES = int(os.getenv("FABLE_VELOCITY_WINDOW_MIN", "10"))
VELOCITY_FLAG_COUNT = int(os.getenv("FABLE_VELOCITY_FLAG", "3"))
VELOCITY_HIGH_COUNT = int(os.getenv("FABLE_VELOCITY_HIGH", "5"))

# Amount anomaly is progressive: the multiple of the user's baseline decides
# the tier, so a 45x spike outweighs a milder 6x one instead of capping out.
AMOUNT_TIERS = (50, 25, 10, 5)


# A channel weight at or below this adds nothing: the rail is not a signal.
CHANNEL_GATE = 0.05


def channel_key(channel: str | None) -> str:
    """The weight key for a channel; anything unlisted uses the "unknown" one."""
    key = f"channel_{channel}"
    return key if key in engine_config.WEIGHT_DEFAULTS else "channel_unknown"


def amount_key(tier: int) -> str:
    return f"amount_{tier}x" if tier else "amount_3x"


def amount_tier(multiplier: float) -> int:
    for tier in AMOUNT_TIERS:
        if multiplier >= tier:
            return tier
    return 0


def amount_anomaly_boost(multiplier: float, p: dict | None = None) -> tuple[float, int]:
    """Return (boost, tier) for how far a transfer sits above the baseline."""
    tier = amount_tier(multiplier)
    return weights(p)[amount_key(tier)], tier


# --- Per-channel decision thresholds ---------------------------------------
# The cutoff for FLAG/BLOCK is not universal: the same score means more on a
# riskier rail. Internet and card channels — the ones NIBSS ties to the most
# loss — trip sooner; an in-person branch transfer is given more room.
#
# USSD gets *more* room than the default, not less. It carries little reported
# fraud, and it is the rail Nigeria's feature-phone population banks on, so a
# customer there is the least able to complete a step-up: no smartphone means
# no passkey, and often no registered email for a code.
#
# The values are engine parameters (core/engine_config.py). The environment
# still wins: FABLE_THRESHOLD_<CHANNEL>_<BLOCK|FLAG>, and FABLE_BLOCK_THRESHOLD
# / FABLE_FLAG_THRESHOLD for the default.

def default_thresholds(p: dict | None = None) -> dict:
    return dict((p or params())["thresholds"]["default"])


def thresholds_for(channel: str | None, institution_id: str | None = None, p: dict | None = None) -> dict:
    """The (block, flag) cutoffs for a channel, falling back to the default.

    When the institution has set its own base cutoffs, the channel's offset
    from Fable's default is kept and applied to the institution's base, so the
    per-channel tuning survives a bank moving its overall risk appetite.
    """
    p = p or params()
    default = p["thresholds"]["default"]
    th = dict(p["thresholds"].get(channel or "", default))
    if not institution_id:
        return th
    from services.policy import base_thresholds

    base = base_thresholds(institution_id)
    if base is None:
        return th
    block, flag = base
    return {
        "block": round(min(max(block + (th["block"] - default["block"]), 0.1), 0.99), 3),
        "flag": round(min(max(flag + (th["flag"] - default["flag"]), 0.05), 0.98), 3),
    }


def decide(score: float, channel: str | None, institution_id: str | None = None,
           p: dict | None = None) -> tuple[str, str]:
    """(action, risk level) for a final score."""
    th = thresholds_for(channel, institution_id, p)
    action = "BLOCK" if score >= th["block"] else "FLAG" if score >= th["flag"] else "PASS"
    level = "HIGH" if score >= th["block"] else "MEDIUM" if score >= th["flag"] else "LOW"
    return action, level


# --- Score parts -------------------------------------------------------------
# A term is [coefficients, constant, divisor, rounded, gate]:
#
#     value = (constant + sum(coefficient * weight[key])) / divisor
#
# rounded to 3 places when `rounded` is set, and counted only when it is above
# `gate` (when one is given; channel risk uses CHANNEL_GATE). Fixed
# contributions (cold start, NIP code, scam pattern, ML anomaly) are terms with
# no keys. Parts recorded before the gate existed have four elements.
# The final score is the terms added in order, then the tenure discount, the
# clamp to [0, 1] and the NIP-34 override, exactly as the analyzer always did.

def term(coefs: dict | None = None, const: float = 0.0, divisor: float = 1, rounded: bool = False,
         gate: float | None = None) -> list:
    t = [dict(coefs or {}), const, divisor, 1 if rounded else 0]
    return t + [gate] if gate is not None else t


def term_value(t: list, w: dict) -> float:
    coefs, const, divisor, rounded = t[:4]
    x = const
    for key, coef in coefs.items():
        x += coef * w[key]
    x = x / divisor if divisor != 1 else x
    x = round(x, 3) if rounded else x
    if len(t) > 4 and t[4] is not None and not x > t[4]:
        return 0.0
    return x


def raw_score(parts: dict, w: dict) -> float:
    score = 0.0
    for t in parts.get("terms") or []:
        score += term_value(t, w)
    return score


def finish(score: float, parts: dict) -> float:
    """Tenure, clamp and the NIP-34 override, applied to a raw score."""
    discount = parts.get("tenure") or 0.0
    if discount > 0 and score > 0:
        score -= min(discount, score)
    score = min(round(max(score, 0.0), 3), 1.0)
    if parts.get("nip34"):
        score = max(score, 0.95)
    return score


def tenure_applied(score: float, parts: dict) -> float:
    discount = parts.get("tenure") or 0.0
    return min(discount, score) if discount > 0 and score > 0 else 0.0


def replay(parts: dict, channel: str | None, institution_id: str | None, p: dict) -> tuple[float, str]:
    """(score, action) for a stored decision's parts under parameters `p`."""
    score = finish(raw_score(parts, p["weights"]), parts)
    return score, decide(score, channel, institution_id, p)[0]
