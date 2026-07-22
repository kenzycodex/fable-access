"""Fable Copilot — behavioral baseline engine.

Builds a 90-day behavioral profile per user from transaction history so
Shield can judge anomalies against *this user's* normal, not a global
average.
"""
import statistics
from datetime import datetime, timedelta

from db import DEFAULT_INSTITUTION_ID, cursor, row_to_dict, loads

MIN_TRANSACTIONS_FOR_BASELINE = 3

# A brand-new account is precisely when mule and takeover activity happens, so
# "no history" must not mean "no scrutiny". Below the personal threshold Shield
# falls back to how this institution's customers behave in aggregate, and
# treats the account's newness as a risk factor in its own right.
COLD_START_PREMIUM = 0.15
POPULATION_MIN_TRANSACTIONS = 20


def get_user_baseline(user_id: str) -> dict | None:
    ninety_days_ago = (datetime.utcnow() - timedelta(days=90)).isoformat()

    with cursor() as cur:
        cur.execute(
            """SELECT * FROM transactions
               WHERE user_id = ? AND created_at >= ? AND confirmed_legitimate = 1
               ORDER BY created_at ASC""",
            (user_id, ninety_days_ago),
        )
        rows = [row_to_dict(r) for r in cur.fetchall()]

    if len(rows) < MIN_TRANSACTIONS_FOR_BASELINE:
        return None

    amounts = [r["amount"] for r in rows]
    hours = [r["hour_of_day"] for r in rows if r["hour_of_day"] is not None]
    recipients = {r["recipient_account"] for r in rows if r["recipient_account"]}
    devices = {r["device_fingerprint"] for r in rows if r["device_fingerprint"]}
    channels = [r["channel"] for r in rows if r["channel"]]

    # Devices the customer explicitly trusted by enrolling a passkey on them are
    # known too, even before a transfer from them has settled. Enrolling device
    # unlock is a deliberate act of trust, so the next transfer from that device
    # shouldn't be flagged as coming from a stranger.
    with cursor() as cur:
        cur.execute(
            "SELECT fingerprint_id FROM device_profiles WHERE user_id = ? AND trusted = 1",
            (user_id,),
        )
        devices |= {r["fingerprint_id"] for r in cur.fetchall() if r["fingerprint_id"]}

    # New behavioral dimensions (columns may be NULL for old/seed rows)
    cities = {r["city"] for r in rows if r.get("city")}
    countries = [r["country"] for r in rows if r.get("country")]
    timezones = [r["client_timezone"] for r in rows if r.get("client_timezone")]
    session_durations = [r["session_duration_seconds"] for r in rows if r.get("session_duration_seconds")]
    submit_times = [r["time_to_submit_seconds"] for r in rows if r.get("time_to_submit_seconds")]

    avg_amount = statistics.mean(amounts)
    stdev_amount = statistics.stdev(amounts) if len(amounts) > 1 else avg_amount * 0.5

    # Typical hours = the set of hours covering the bulk of activity
    hour_counts: dict[int, int] = {}
    for h in hours:
        hour_counts[h] = hour_counts.get(h, 0) + 1
    typical_hours = sorted(hour_counts, key=hour_counts.get, reverse=True)
    typical_hours = sorted(typical_hours[: max(6, len(typical_hours) // 2 + 1)])

    preferred_channel = max(set(channels), key=channels.count) if channels else "mobile_app"

    return {
        "user_id": user_id,
        "avg_amount": avg_amount,
        "max_typical_amount": avg_amount + (2 * stdev_amount),
        "typical_hours": typical_hours,
        "known_recipients": recipients,
        "known_devices": devices,
        "known_cities": cities,
        "home_country": max(set(countries), key=countries.count) if countries else None,
        "typical_timezone": max(set(timezones), key=timezones.count) if timezones else None,
        "avg_session_duration": statistics.mean(session_durations) if session_durations else None,
        "avg_time_to_submit": statistics.mean(submit_times) if submit_times else None,
        "preferred_channel": preferred_channel,
        "transaction_count": len(rows),
        "last_updated": datetime.utcnow().isoformat(),
    }


def get_population_baseline(institution_id: str | None) -> dict | None:
    """How this institution's customers behave in aggregate.

    Used when a customer has too little history for a personal baseline.
    Judging a first transfer against the population is far better than
    judging it against nothing: without this, six of the twelve layers
    silently skipped and a new account could move almost any amount.
    """
    where = "WHERE confirmed_legitimate = 1 AND created_at >= ?"
    params: list = [(datetime.utcnow() - timedelta(days=90)).isoformat()]
    if institution_id:
        where += " AND institution_id = ?"
        params.append(institution_id)

    with cursor() as cur:
        cur.execute(f"SELECT amount, hour_of_day, city, country FROM transactions {where}", params)
        rows = [row_to_dict(r) for r in cur.fetchall()]

    if len(rows) < POPULATION_MIN_TRANSACTIONS:
        return None

    amounts = [r["amount"] for r in rows]
    hours = [r["hour_of_day"] for r in rows if r["hour_of_day"] is not None]
    countries = [r["country"] for r in rows if r.get("country")]

    avg_amount = statistics.mean(amounts)
    # The median resists the long tail of large business transfers, which
    # would otherwise drag the "normal" amount up and hide real anomalies.
    median_amount = statistics.median(amounts)

    hour_counts: dict[int, int] = {}
    for h in hours:
        hour_counts[h] = hour_counts.get(h, 0) + 1
    typical_hours = sorted(hour_counts, key=hour_counts.get, reverse=True)
    typical_hours = sorted(typical_hours[: max(8, len(typical_hours) // 2 + 1)]) or list(range(6, 23))

    return {
        "is_population": True,
        "avg_amount": median_amount,
        "max_typical_amount": avg_amount * 3,
        "typical_hours": typical_hours,
        "known_recipients": set(),
        "known_devices": set(),
        "known_cities": set(),
        "home_country": max(set(countries), key=countries.count) if countries else "Nigeria",
        "typical_timezone": None,
        "avg_session_duration": None,
        "avg_time_to_submit": None,
        "preferred_channel": "mobile_app",
        "transaction_count": len(rows),
        "last_updated": datetime.utcnow().isoformat(),
    }


def get_user_history_arrays(user_id: str) -> tuple[list[float], list[int]]:
    """Raw amount/hour arrays for the user's confirmed-legitimate history,
    used by the Isolation Forest anomaly scorer."""
    ninety_days_ago = (datetime.utcnow() - timedelta(days=90)).isoformat()
    with cursor() as cur:
        cur.execute(
            """SELECT amount, hour_of_day FROM transactions
               WHERE user_id = ? AND created_at >= ? AND confirmed_legitimate = 1""",
            (user_id, ninety_days_ago),
        )
        rows = cur.fetchall()
    amounts = [r["amount"] for r in rows]
    hours = [r["hour_of_day"] if r["hour_of_day"] is not None else 12 for r in rows]
    return amounts, hours


def format_hours(hours: list[int]) -> str:
    if not hours:
        return "No pattern established yet"
    start, end = min(hours), max(hours)

    def fmt(h):
        suffix = "AM" if h < 12 else "PM"
        hour12 = h % 12
        hour12 = 12 if hour12 == 0 else hour12
        return f"{hour12} {suffix}"

    return f"{fmt(start)} – {fmt(end)}"


def log_transaction(
    user_id: str,
    transaction_id: str,
    transaction: dict,
    device_fingerprint: str | None,
    risk_score: float,
    risk_level: str,
    action_taken: str,
    signals: list[str],
    is_seed: bool = False,
    created_at: str | None = None,
    confirmed_legitimate: bool = True,
    device: dict | None = None,
    context: dict | None = None,
    institution_id: str | None = None,
    client_reference: str | None = None,
    latency_ms: float | None = None,
    decision_ms: float | None = None,
    explanation: str | None = None,
    explanation_source: str | None = None,
):
    from db import cursor as _cursor, dumps

    device = device or {}
    context = context or {}

    ts = created_at or datetime.utcnow().isoformat()
    # Time-of-day baseline learns from the *device's* local time when the SDK
    # sends it (server UTC misplaces Lagos evenings by an hour).
    hour = _client_hour(context) if context.get("client_timestamp") else datetime.fromisoformat(ts).hour

    with _cursor() as cur:
        cur.execute(
            """INSERT INTO transactions
               (id, user_id, amount, currency, recipient_id, recipient_account, recipient_bank,
                narration, channel, device_fingerprint, hour_of_day, risk_score, risk_level,
                action_taken, shield_signals, confirmed_legitimate, is_seed, created_at,
                client_ip, latitude, longitude, city, country, location_source,
                session_duration_seconds, auth_method, typing_speed_ms, paste_detected,
                time_to_submit_seconds, client_timestamp, client_timezone, institution_id,
                recipient_name, client_reference, latency_ms, decision_ms,
                explanation, explanation_source, status)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            (
                transaction_id,
                user_id,
                transaction.get("amount"),
                transaction.get("currency", "NGN"),
                transaction.get("recipient_id"),
                transaction.get("recipient_account"),
                transaction.get("recipient_bank"),
                transaction.get("narration", ""),
                transaction.get("channel", "mobile_app"),
                device_fingerprint,
                hour,
                risk_score,
                risk_level,
                action_taken,
                dumps(signals),
                1 if confirmed_legitimate else 0,
                1 if is_seed else 0,
                ts,
                device.get("ip"),
                context.get("latitude"),
                context.get("longitude"),
                context.get("city"),
                context.get("country"),
                context.get("location_source"),
                context.get("session_duration_seconds"),
                context.get("auth_method"),
                context.get("typing_speed_ms"),
                1 if context.get("paste_detected") else 0 if context.get("paste_detected") is not None else None,
                context.get("time_to_submit_seconds"),
                context.get("client_timestamp"),
                context.get("client_timezone") or device.get("timezone"),
                institution_id or DEFAULT_INSTITUTION_ID,
                transaction.get("recipient_name"),
                client_reference,
                latency_ms,
                decision_ms,
                explanation,
                explanation_source,
                # Initial lifecycle state, before the customer acts. A PASS has
                # already moved; a FLAG awaits a decision; a BLOCK is stopped.
                # Overrides (verify a flag, release a hold) update this later.
                {"PASS": "completed", "FLAG": "flagged", "BLOCK": "blocked"}.get(action_taken, "completed"),
            ),
        )

    if device.get("fingerprint_id"):
        record_device_profile(user_id, device)
    if context.get("latitude") is not None or context.get("city"):
        record_location(user_id, context)


def _client_hour(context: dict) -> int:
    """Hour-of-day from the device's local clock, falling back to server UTC.

    The SDK sends client_timestamp as local time WITH its UTC offset
    (e.g. 2026-07-18T21:04:11+01:00), so the parsed hour is already the
    device-local hour — no server-timezone conversion.
    """
    try:
        return datetime.fromisoformat(str(context["client_timestamp"]).replace("Z", "+00:00")).hour
    except (ValueError, KeyError):
        return datetime.utcnow().hour


def record_device_profile(user_id: str, device: dict) -> None:
    """Upsert the device into the per-user device catalogue Copilot learns from."""
    from db import cursor as _cursor

    screen = None
    if device.get("screen_width") and device.get("screen_height"):
        screen = f"{device['screen_width']}x{device['screen_height']}"

    with _cursor() as cur:
        cur.execute(
            """INSERT INTO device_profiles
               (fingerprint_id, user_id, platform, os, browser, screen, gpu, language, timezone, touch_support)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
               ON CONFLICT(fingerprint_id) DO UPDATE SET
                 last_seen = datetime('now'),
                 times_seen = times_seen + 1,
                 trust_score = min(1.0, trust_score + 0.05)""",
            (
                device.get("fingerprint_id"),
                user_id,
                device.get("platform"),
                device.get("os"),
                device.get("browser"),
                screen,
                device.get("gpu_renderer"),
                device.get("language"),
                device.get("timezone"),
                1 if device.get("touch_support") else 0 if device.get("touch_support") is not None else None,
            ),
        )


def record_location(user_id: str, context: dict) -> None:
    """Append to the user's location trail (feeds the location-anomaly signal)."""
    from db import cursor as _cursor

    with _cursor() as cur:
        cur.execute(
            """INSERT INTO user_locations (user_id, latitude, longitude, city, region, country, source)
               VALUES (?, ?, ?, ?, ?, ?, ?)""",
            (
                user_id,
                context.get("latitude"),
                context.get("longitude"),
                context.get("city"),
                context.get("region"),
                context.get("country"),
                context.get("location_source"),
            ),
        )
