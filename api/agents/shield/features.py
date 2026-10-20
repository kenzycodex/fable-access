"""The feature snapshot of a decision: every input a richer per-customer model
will need, computed from the same values Shield scored with, and stored with
the decision (table decision_features).

Shield's rules read some of these directly. The rest are recorded now so a
later model can be trained and backtested on what was actually known at the
moment of each decision, rather than reconstructed afterwards.

What a snapshot never holds: names, account numbers, narration text, exact
GPS, or IP addresses. A recipient appears only as "known or new" with counts
and dates; narration only as the scam-pattern labels it matched; location
only as same-or-not and a rounded distance. Snapshots follow the decision's
retention (services/retention.py) and the customer's erasure
(services/data_rights.py).

The analyst's label is not copied in: it changes after the decision. Join on
transaction_id (the decision_dataset view does this) to read it.
"""
from __future__ import annotations

import json
import logging
import math
import statistics
from datetime import date, datetime, timezone

from agents.shield.places import haversine_km
from core.db import cursor

logger = logging.getLogger("fable.features")

# 2: session.review_s, and time_to_submit_s stops at tapping Send (not the review sheet);
#    amount.share_of_balance.
FEATURE_VERSION = 2
# Code versions of the parts that shape a decision besides the engine
# parameters (which carry their own version and hash). Bump when behaviour
# changes.
COPILOT_VERSION = "copilot-2026.10"
GHOST_VERSION = "ghost-2026.10"

# Nigerian public holidays with a fixed date. Easter and the Eid holidays move
# every year and are announced late, so they are not included; the feature
# name says so.
FIXED_HOLIDAYS = {(1, 1), (5, 1), (6, 12), (10, 1), (12, 25), (12, 26)}
DISTANCE_STEP_KM = 5


def _local_time(context: dict) -> datetime:
    ts = context.get("client_timestamp")
    if ts:
        try:
            return datetime.fromisoformat(str(ts).replace("Z", "+00:00"))
        except ValueError:
            pass
    return datetime.now(timezone.utc)


def _days_since(stamp: str | None, now: datetime) -> float | None:
    if not stamp:
        return None
    try:
        then = datetime.fromisoformat(str(stamp).replace("Z", "+00:00").replace(" ", "T"))
    except ValueError:
        return None
    if then.tzinfo is None:
        then = then.replace(tzinfo=timezone.utc)
    return round((now - then).total_seconds() / 86400, 1)


def build(user_id: str, institution_id: str | None, transaction: dict, device: dict, context: dict,
          seen: dict, result: dict) -> dict:
    """The snapshot for one decision. `seen` holds the values the analyzer
    computed while scoring; nothing here re-derives a value it already had."""
    from core import privacy

    now = datetime.now(timezone.utc)
    local = _local_time(context)
    baseline = seen.get("baseline") or {}
    cold = bool(seen.get("cold_start"))
    source = "none" if not seen.get("baseline") else ("population" if cold else "personal")
    amount = float(transaction.get("amount") or 0)
    recipient = transaction.get("recipient_account") or ""

    with cursor() as cur:
        # Personal history in the scoring window, for the median and channel share.
        cur.execute(
            """SELECT amount, channel FROM customer_history WHERE user_id = ? AND confirmed_legitimate = 1
                 AND datetime(created_at) >= datetime('now', '-90 days')""",
            (user_id,),
        )
        rows = cur.fetchall()
        amounts = [float(r["amount"] or 0) for r in rows]
        channels = [r["channel"] for r in rows if r["channel"]]

        cur.execute("SELECT MIN(created_at) AS first FROM customer_history WHERE user_id = ? AND confirmed_legitimate = 1",
                    (user_id,))
        first_seen = cur.fetchone()["first"]

        paid = {"n": 0, "first": None, "last": None}
        if recipient:
            cur.execute(
                """SELECT COUNT(*) AS n, MIN(created_at) AS first, MAX(created_at) AS last FROM customer_history
                   WHERE user_id = ? AND recipient_account = ? AND confirmed_legitimate = 1""",
                (user_id, recipient),
            )
            paid = dict(cur.fetchone())

        velocity = {}
        for label, modifier in (("10m", "-10 minutes"), ("1h", "-1 hour"), ("24h", "-1 day")):
            cur.execute(
                """SELECT COUNT(*) AS n, COALESCE(SUM(amount), 0) AS total FROM transactions
                   WHERE user_id = ? AND datetime(created_at) >= datetime('now', ?)""",
                (user_id, modifier),
            )
            row = cur.fetchone()
            velocity[label] = (row["n"], float(row["total"] or 0))

        fingerprint = device.get("fingerprint_id")
        dev = None
        if fingerprint:
            cur.execute("SELECT trust_score, times_seen FROM customer_devices WHERE user_id = ? AND fingerprint_id = ?",
                        (user_id, fingerprint))
            dev = cur.fetchone()

        here = (privacy.coarse(context.get("latitude")), privacy.coarse(context.get("longitude")))
        distance = None
        if here[0] is not None and here[1] is not None:
            cur.execute("SELECT DISTINCT latitude, longitude FROM user_locations WHERE user_id = ? "
                        "AND latitude IS NOT NULL AND longitude IS NOT NULL", (user_id,))
            usual = [(r["latitude"], r["longitude"]) for r in cur.fetchall()]
            if usual:
                nearest = min(haversine_km(here, u) for u in usual)
                distance = int(round(nearest / DISTANCE_STEP_KM) * DISTANCE_STEP_KM)

    avg = float(baseline.get("avg_amount") or 0) or None
    median = statistics.median(amounts) if amounts else (avg if cold else None)
    stdev = float(baseline.get("stdev_amount") or 0) or None
    hour = seen.get("now_hour")
    angle = (hour % 24) * 2 * math.pi / 24 if hour is not None else None
    local_day = date(local.year, local.month, local.day)
    pattern = seen.get("pattern")
    known_cities = seen.get("known_cities") or set()
    city, country = context.get("city"), context.get("country")
    home_country = baseline.get("home_country")
    device_tz, typical_tz = seen.get("device_tz"), baseline.get("typical_timezone")
    channel = transaction.get("channel")

    from intelligence.context import PATTERN_LABELS
    from services import policy

    hold = policy.effective(institution_id) if institution_id else {}
    return {
        "amount": {
            "raw": amount,
            "log": round(math.log1p(max(amount, 0)), 4),
            "ratio_to_average": round(amount / avg, 3) if avg else None,
            "ratio_to_median": round(amount / median, 3) if median else None,
            "zscore": round((amount - avg) / stdev, 3) if avg and stdev else None,
            "first_transfer": cold,
            # Share of the balance available before the transfer; None when
            # the balance was not known (a live bank that did not send it).
            "share_of_balance": round(seen["balance_share"], 4) if seen.get("balance_share") is not None else None,
        },
        "time": {
            "hour": hour,
            "hour_sin": round(math.sin(angle), 4) if angle is not None else None,
            "hour_cos": round(math.cos(angle), 4) if angle is not None else None,
            "hour_source": "device" if seen.get("client_hour") is not None else "server",
            "day_of_week": local_day.isoweekday(),
            "weekend": local_day.isoweekday() >= 6,
            "public_holiday_fixed": (local_day.month, local_day.day) in FIXED_HOLIDAYS,
            "usual_hours": list(baseline.get("typical_hours") or []) if not cold else None,
        },
        "recipient": {
            "known": bool(recipient) and recipient in (baseline.get("known_recipients") or set()) and not cold,
            "times_paid_before": int(paid.get("n") or 0),
            "days_since_first_paid": _days_since(paid.get("first"), now),
            "days_since_last_paid": _days_since(paid.get("last"), now),
            "bank": transaction.get("recipient_bank") or transaction.get("recipient_bank_code"),
            # Fable is not told which accounts belong to the customer.
            "own_account": None,
        },
        "device": {
            "known": bool(fingerprint) and fingerprint in (baseline.get("known_devices") or set()) and not cold,
            "trust_score": round(float(dev["trust_score"]), 3) if dev and dev["trust_score"] is not None else None,
            "times_seen": int(dev["times_seen"]) if dev and dev["times_seen"] is not None else 0,
            "platform": device.get("platform"),
            "os": device.get("os"),
            "browser": device.get("browser"),
        },
        "location": {
            "shared": city is not None or country is not None or here[0] is not None,
            "same_city": (city in known_cities) if city and known_cities else None,
            "same_country": (country == home_country) if country and home_country else None,
            "distance_km_from_usual": distance,
            "timezone_match": (device_tz == typical_tz) if device_tz and typical_tz else None,
        },
        "channel": {
            "channel": channel,
            "usual_share": round(channels.count(channel) / len(channels), 3) if channels else None,
        },
        "velocity": {
            "transfers_10m": velocity["10m"][0],
            "transfers_1h": velocity["1h"][0],
            "transfers_24h": velocity["24h"][0],
            "amount_24h": velocity["24h"][1],
        },
        "session": {
            "session_age_s": context.get("session_duration_seconds"),
            "time_to_submit_s": context.get("time_to_submit_seconds"),
            "review_s": context.get("review_seconds"),
            "paste_detected": context.get("paste_detected"),
            "typing_speed_ms": context.get("typing_speed_ms"),
        },
        "narration": {
            "scam_patterns": [PATTERN_LABELS.get(pattern["name"], pattern["name"])] if pattern else [],
        },
        "verification": {"recent_failed_stepups": seen.get("failed", 0)},
        "context": {
            "baseline_source": source,
            "history_length": len(amounts),
            "tenure_days": _days_since(first_seen, now),
            "institution_id": institution_id,
            "engine_version": result.get("engine_version"),
            "engine_params_hash": result.get("engine_params_hash"),
            "copilot_version": COPILOT_VERSION,
            "ghost_version": GHOST_VERSION,
            "ghost_hold_minutes": [hold.get("hold_high_minutes"), hold.get("hold_medium_minutes"),
                                   hold.get("hold_low_minutes")] if hold else None,
            "feature_version": FEATURE_VERSION,
        },
        "outcome": {
            "decision": result.get("action"),
            "risk_score": result.get("risk_score"),
            "signals": [s.split(":", 1)[0] for s in result.get("signals") or []],
        },
    }


def store(transaction_id: str, user_id: str, institution_id: str | None, features: dict) -> None:
    """Write the snapshot. Never raises: a snapshot must not affect a decision."""
    try:
        with cursor() as cur:
            cur.execute(
                """INSERT OR REPLACE INTO decision_features (transaction_id, user_id, institution_id, feature_version,
                                                             features) VALUES (?, ?, ?, ?, ?)""",
                (transaction_id, user_id, institution_id, FEATURE_VERSION,
                 json.dumps(features, separators=(",", ":"), default=str)),
            )
    except Exception as exc:  # noqa: BLE001
        logger.warning("Could not store the feature snapshot for %s: %s", transaction_id, exc)

