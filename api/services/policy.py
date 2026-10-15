"""An institution's own risk policy.

Fable ships defaults: a flag and a block cutoff, adjusted per channel, and Ghost
cooling windows by risk. A bank can move its base cutoffs and hold lengths to
match its own appetite. Nothing here is required: a bank that never touches it
scores exactly as before, because every column is NULL until set.

The base cutoffs move the whole curve. The per-channel adjustments still apply
on top, so a bank that loosens its flag cutoff still gets USSD treated more
gently than internet banking, the same as the defaults do.
"""
import time

from core.db import cursor, row_to_dict
from core.secrets import setting

THRESHOLD_MIN, THRESHOLD_MAX = 0.2, 0.95
HOLD_MIN, HOLD_MAX = 5, 1440
MIN_GAP = 0.05  # flag must sit at least this far below block

# A policy is read on every scoring decision, so it is cached briefly. Writes
# clear the cache for their institution, so a change applies on the next call
# in this process; other worker processes catch up within the TTL.
_CACHE_TTL = 15.0
_cache: dict[str, tuple[float, dict]] = {}


def _row(institution_id: str) -> dict:
    hit = _cache.get(institution_id)
    if hit and time.monotonic() - hit[0] < _CACHE_TTL:
        return hit[1]
    try:
        with cursor() as cur:
            cur.execute("SELECT * FROM institution_settings WHERE institution_id = ?", (institution_id,))
            row = row_to_dict(cur.fetchone()) or {}
    except Exception:  # noqa: BLE001 - a database without the table yet
        row = {}
    _cache[institution_id] = (time.monotonic(), row)
    return row


def defaults() -> dict:
    from agents.shield.weights import default_thresholds

    th = default_thresholds()
    return {
        "flag_threshold": th["flag"],
        "block_threshold": th["block"],
        "hold_high_minutes": setting("GHOST_COOLING_HIGH"),
        "hold_medium_minutes": setting("GHOST_COOLING_MED"),
        "hold_low_minutes": setting("GHOST_COOLING_LOW"),
    }


def effective(institution_id: str | None) -> dict:
    """The values in force for this institution, with which ones are custom."""
    base = defaults()
    row = _row(institution_id) if institution_id else {}
    out = {}
    for key, default in base.items():
        value = row.get(key)
        out[key] = value if value is not None else default
    out["custom"] = sorted(k for k in base if row.get(k) is not None)
    out["updated_by"] = row.get("updated_by")
    out["updated_at"] = row.get("updated_at")
    return out


def base_thresholds(institution_id: str | None) -> tuple[float, float] | None:
    """(block, flag) the institution chose, or None to use Fable's defaults."""
    if not institution_id:
        return None
    row = _row(institution_id)
    if row.get("flag_threshold") is None and row.get("block_threshold") is None:
        return None
    d = defaults()
    block = row.get("block_threshold") if row.get("block_threshold") is not None else d["block_threshold"]
    flag = row.get("flag_threshold") if row.get("flag_threshold") is not None else d["flag_threshold"]
    return float(block), float(flag)


def cooling_minutes(institution_id: str | None, risk_score: float) -> int:
    p = effective(institution_id)
    if risk_score >= 0.9:
        return int(p["hold_high_minutes"])
    if risk_score >= 0.7:
        return int(p["hold_medium_minutes"])
    return int(p["hold_low_minutes"])


class PolicyError(ValueError):
    pass


def update(institution_id: str, changes: dict, by: str) -> dict:
    """Validate and save. `None` for a field resets it to Fable's default."""
    current = effective(institution_id)
    merged = {k: changes.get(k, current[k]) for k in defaults()}
    for k in defaults():
        if k in changes and changes[k] is None:
            merged[k] = defaults()[k]

    flag, block = float(merged["flag_threshold"]), float(merged["block_threshold"])
    for name, v in (("Flag", flag), ("Block", block)):
        if not THRESHOLD_MIN <= v <= THRESHOLD_MAX:
            raise PolicyError(f"{name} threshold must be between {THRESHOLD_MIN} and {THRESHOLD_MAX}.")
    if block - flag < MIN_GAP - 1e-9:  # 0.95 - 0.90 is 0.0499999... in floating point
        raise PolicyError(f"The flag threshold must be at least {MIN_GAP} below the block threshold.")
    for k in ("hold_high_minutes", "hold_medium_minutes", "hold_low_minutes"):
        v = int(merged[k])
        if not HOLD_MIN <= v <= HOLD_MAX:
            raise PolicyError(f"Hold windows must be between {HOLD_MIN} and {HOLD_MAX} minutes.")
        merged[k] = v
    if not merged["hold_high_minutes"] >= merged["hold_medium_minutes"] >= merged["hold_low_minutes"]:
        raise PolicyError("Riskier transfers must be held at least as long as less risky ones.")

    # Store NULL where the value equals the default, so a later change to
    # Fable's defaults still reaches banks that never chose otherwise.
    d = defaults()
    stored = {k: (None if abs(float(merged[k]) - float(d[k])) < 1e-9 else merged[k]) for k in d}
    with cursor() as cur:
        cur.execute(
            """INSERT INTO institution_settings
               (institution_id, flag_threshold, block_threshold, hold_high_minutes,
                hold_medium_minutes, hold_low_minutes, updated_by, updated_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'))
               ON CONFLICT(institution_id) DO UPDATE SET
                 flag_threshold = excluded.flag_threshold,
                 block_threshold = excluded.block_threshold,
                 hold_high_minutes = excluded.hold_high_minutes,
                 hold_medium_minutes = excluded.hold_medium_minutes,
                 hold_low_minutes = excluded.hold_low_minutes,
                 updated_by = excluded.updated_by,
                 updated_at = excluded.updated_at""",
            (institution_id, stored["flag_threshold"], stored["block_threshold"],
             stored["hold_high_minutes"], stored["hold_medium_minutes"], stored["hold_low_minutes"], by),
        )
    _cache.pop(institution_id, None)
    return effective(institution_id)
