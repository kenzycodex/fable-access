"""Fable Copilot — behavioral baseline engine.

Builds a 90-day behavioral profile per user from transaction history so
Shield can judge anomalies against *this user's* normal, not a global
average.
"""
import statistics
from datetime import datetime, timedelta

from db import cursor, row_to_dict, loads

MIN_TRANSACTIONS_FOR_BASELINE = 3


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
        "preferred_channel": preferred_channel,
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
):
    from db import cursor as _cursor, dumps

    ts = created_at or datetime.utcnow().isoformat()
    hour = datetime.fromisoformat(ts).hour

    with _cursor() as cur:
        cur.execute(
            """INSERT INTO transactions
               (id, user_id, amount, currency, recipient_id, recipient_account, recipient_bank,
                narration, channel, device_fingerprint, hour_of_day, risk_score, risk_level,
                action_taken, shield_signals, confirmed_legitimate, is_seed, created_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
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
            ),
        )
