"""Agent-level analytics for the institution dashboard's Agents section.

Lets a risk team see each Fable agent as an operational unit: what Copilot has
learned per customer, how Shield's 12-signal pipeline is deciding, and what
Ghost has contained — all straight from SQLite, no synthetic numbers.
"""
from datetime import datetime, timezone

from fastapi import APIRouter, Query

from config import BLOCK_THRESHOLD, FLAG_THRESHOLD, GHOST_COOLING_HIGH, GHOST_COOLING_MED, GHOST_COOLING_LOW
from db import cursor, row_to_dict, loads
from agents.copilot.baseline import get_user_baseline, format_hours

router = APIRouter(prefix="/v1/agents", tags=["agents"])


# The Shield pipeline, as configuration the dashboard can render. Weights are
# the maximum boost each layer can contribute.
SHIELD_PIPELINE = [
    {"step": 1, "code": "amount_anomaly", "label": "Amount anomaly", "max_weight": 0.25,
     "description": "Progressive boost when the amount is 3x/5x/10x the user's personal average."},
    {"step": 2, "code": "new_recipient", "label": "New recipient", "max_weight": 0.20,
     "description": "First transfer to this account in the user's 90-day history."},
    {"step": 3, "code": "time_anomaly", "label": "Time anomaly", "max_weight": 0.12,
     "description": "Device-local hour outside the user's typical active hours."},
    {"step": 4, "code": "channel_risk", "label": "Channel risk", "max_weight": 0.25,
     "description": "NIBSS fraud-incidence weights per channel (USSD highest)."},
    {"step": 5, "code": "nip_code", "label": "NIP response code", "max_weight": 0.95,
     "description": "NIBSS instant-payment risk codes; code 34 is an automatic block."},
    {"step": 6, "code": "scam_pattern", "label": "Scam pattern (narration)", "max_weight": 0.25,
     "description": "English + Pidgin scam-script matching. Deliberately de-prioritized (x0.5) — most users skip narration."},
    {"step": 7, "code": "ml_anomaly", "label": "ML anomaly (Isolation Forest)", "max_weight": 0.15,
     "description": "Unsupervised deviation from the user's own amount/hour history."},
    {"step": 8, "code": "device_anomaly", "label": "Device anomaly", "max_weight": 0.18,
     "description": "Unrecognized device fingerprint; weight scales with transfer size."},
    {"step": 9, "code": "location_anomaly", "label": "Location anomaly", "max_weight": 0.22,
     "description": "Transacting outside known cities, strongest when outside the home country."},
    {"step": 10, "code": "session_freshness", "label": "Session freshness", "max_weight": 0.12,
     "description": "Large transfer within 30 seconds of login."},
    {"step": 11, "code": "behavioral_anomaly", "label": "Behavioral anomaly", "max_weight": 0.15,
     "description": "Pasted account number and near-zero hesitation on a large amount."},
    {"step": 12, "code": "timezone_mismatch", "label": "Timezone mismatch", "max_weight": 0.08,
     "description": "Device timezone disagrees with the user's usual timezone."},
]


@router.get("/overview")
def overview():
    with cursor() as cur:
        cur.execute("SELECT COUNT(*) AS n FROM transactions")
        total_tx = cur.fetchone()["n"]

        cur.execute("SELECT COUNT(*) AS n FROM transactions WHERE is_seed = 0")
        live_tx = cur.fetchone()["n"]

        cur.execute("SELECT action_taken AS a, COUNT(*) AS n FROM transactions GROUP BY action_taken")
        by_action = {r["a"] or "PASS": r["n"] for r in cur.fetchall()}

        cur.execute("SELECT AVG(risk_score) AS s FROM transactions")
        avg_score = cur.fetchone()["s"] or 0.0

        cur.execute("SELECT COUNT(DISTINCT user_id) AS n FROM transactions")
        users = cur.fetchone()["n"]

        cur.execute("SELECT COUNT(*) AS n FROM device_profiles")
        devices = cur.fetchone()["n"]

        cur.execute("SELECT COUNT(*) AS n FROM user_locations")
        locations = cur.fetchone()["n"]

        cur.execute("SELECT MAX(created_at) AS t FROM transactions WHERE is_seed = 0")
        last_live = cur.fetchone()["t"]

        cur.execute("SELECT status, COUNT(*) AS n, COALESCE(SUM(amount),0) AS amt FROM ghost_containers GROUP BY status")
        ghost_rows = {r["status"]: {"count": r["n"], "amount": r["amt"]} for r in cur.fetchall()}

    blocked = by_action.get("BLOCK", 0)
    flagged = by_action.get("FLAG", 0)
    passed = by_action.get("PASS", 0)
    ghost_created = sum(g["count"] for g in ghost_rows.values())
    ghost_cancelled = ghost_rows.get("CANCELLED", {}).get("count", 0)

    return {
        "copilot": {
            "status": "active",
            "customers_learned": users,
            "data_points": total_tx,
            "live_data_points": live_tx,
            "devices_tracked": devices,
            "locations_tracked": locations,
            "last_learned_at": last_live,
        },
        "shield": {
            "status": "active",
            "transactions_scored": total_tx,
            "blocked": blocked,
            "flagged": flagged,
            "passed": passed,
            "block_rate": round(blocked / total_tx, 4) if total_tx else 0,
            "flag_rate": round(flagged / total_tx, 4) if total_tx else 0,
            "avg_risk_score": round(avg_score, 3),
            "signal_layers": len(SHIELD_PIPELINE),
            "thresholds": {"block": BLOCK_THRESHOLD, "flag": FLAG_THRESHOLD},
        },
        "ghost": {
            "status": "active",
            "containers_created": ghost_created,
            "cancelled": ghost_cancelled,
            "released": ghost_rows.get("RELEASED", {}).get("count", 0),
            "held": ghost_rows.get("HELD", {}).get("count", 0),
            "cancellation_rate": round(ghost_cancelled / ghost_created, 4) if ghost_created else 0,
            "money_saved_ngn": ghost_rows.get("CANCELLED", {}).get("amount", 0),
        },
        "watch": {
            "status": "coming_soon",
            "description": "Continuous account monitoring between transactions.",
        },
        "generated_at": datetime.now(timezone.utc).isoformat(),
    }


@router.get("/copilot/customers")
def copilot_customers(limit: int = Query(50, ge=1, le=200)):
    """Per-customer view of what Copilot has actually learned."""
    with cursor() as cur:
        cur.execute(
            """SELECT user_id, COUNT(*) AS tx, SUM(is_seed = 0) AS live_tx, MAX(created_at) AS last_seen
               FROM transactions GROUP BY user_id ORDER BY tx DESC LIMIT ?""",
            [limit],
        )
        users = [row_to_dict(r) for r in cur.fetchall()]

    out = []
    for u in users:
        baseline = get_user_baseline(u["user_id"])
        if baseline:
            out.append({
                "user_id": u["user_id"],
                "has_baseline": True,
                "transactions_analyzed": baseline["transaction_count"],
                "live_transactions": u["live_tx"] or 0,
                "typical_range": f"₦{baseline['avg_amount'] * 0.3:,.0f} – ₦{baseline['max_typical_amount']:,.0f}",
                "avg_amount": round(baseline["avg_amount"], 2),
                "active_hours": format_hours(baseline["typical_hours"]),
                "trusted_recipients": len(baseline["known_recipients"]),
                "known_devices": len(baseline["known_devices"]),
                "known_cities": sorted(baseline["known_cities"]),
                "home_country": baseline["home_country"],
                "preferred_channel": baseline["preferred_channel"],
                "avg_session_duration_s": round(baseline["avg_session_duration"], 1) if baseline["avg_session_duration"] else None,
                "avg_time_to_submit_s": round(baseline["avg_time_to_submit"], 1) if baseline["avg_time_to_submit"] else None,
                "last_activity": u["last_seen"],
                "last_updated": baseline["last_updated"],
            })
        else:
            out.append({
                "user_id": u["user_id"],
                "has_baseline": False,
                "transactions_analyzed": u["tx"],
                "live_transactions": u["live_tx"] or 0,
                "last_activity": u["last_seen"],
            })

    return {"customers": out, "total": len(out)}


@router.get("/shield/decisions")
def shield_decisions(limit: int = Query(25, ge=1, le=200)):
    """Recent Shield decisions with full signal breakdowns + the pipeline config."""
    with cursor() as cur:
        cur.execute(
            """SELECT id, user_id, amount, recipient_id, recipient_bank, channel,
                      risk_score, risk_level, action_taken, shield_signals, city, country,
                      location_source, auth_method, session_duration_seconds,
                      typing_speed_ms, paste_detected, device_fingerprint, is_seed, created_at
               FROM transactions ORDER BY created_at DESC LIMIT ?""",
            [limit],
        )
        rows = [row_to_dict(r) for r in cur.fetchall()]

        cur.execute("SELECT COUNT(*) AS n FROM transactions")
        total = cur.fetchone()["n"]
        cur.execute("SELECT action_taken AS a, COUNT(*) AS n FROM transactions GROUP BY action_taken")
        by_action = {r["a"] or "PASS": r["n"] for r in cur.fetchall()}
        # False-positive proxy: FLAG/BLOCK decisions later confirmed legitimate.
        cur.execute(
            "SELECT COUNT(*) AS n FROM transactions WHERE action_taken IN ('FLAG','BLOCK') AND confirmed_legitimate = 1 AND is_seed = 0"
        )
        fp = cur.fetchone()["n"]

    for r in rows:
        r["signals"] = loads(r.pop("shield_signals"), [])

    friction = by_action.get("FLAG", 0) + by_action.get("BLOCK", 0)
    return {
        "decisions": rows,
        "pipeline": SHIELD_PIPELINE,
        "thresholds": {"block": BLOCK_THRESHOLD, "flag": FLAG_THRESHOLD},
        "accuracy": {
            "transactions_scored": total,
            "pass_rate": round(by_action.get("PASS", 0) / total, 4) if total else 0,
            "friction_events": friction,
            "false_positive_proxy": fp,
        },
    }


@router.get("/ghost/containers")
def ghost_containers(limit: int = Query(50, ge=1, le=200)):
    """Container history + resolution stats + cooling-window config."""
    with cursor() as cur:
        cur.execute(
            """SELECT ghost_id, user_id, amount, recipient_id, recipient_account, recipient_bank,
                      status, cooling_window_minutes, risk_score, explanation,
                      created_at, expires_at, resolved_at
               FROM ghost_containers ORDER BY created_at DESC LIMIT ?""",
            [limit],
        )
        rows = [row_to_dict(r) for r in cur.fetchall()]

        cur.execute("SELECT status, COUNT(*) AS n, COALESCE(SUM(amount),0) AS amt FROM ghost_containers GROUP BY status")
        by_status = {r["status"]: {"count": r["n"], "amount": r["amt"]} for r in cur.fetchall()}

    created = sum(s["count"] for s in by_status.values())
    cancelled = by_status.get("CANCELLED", {}).get("count", 0)
    return {
        "containers": rows,
        "stats": {
            "created": created,
            "held": by_status.get("HELD", {}).get("count", 0),
            "cancelled": cancelled,
            "released": by_status.get("RELEASED", {}).get("count", 0),
            "cancellation_rate": round(cancelled / created, 4) if created else 0,
            "money_saved_ngn": by_status.get("CANCELLED", {}).get("amount", 0),
        },
        "cooling_windows": {
            "high_risk_minutes": GHOST_COOLING_HIGH,
            "medium_risk_minutes": GHOST_COOLING_MED,
            "low_risk_minutes": GHOST_COOLING_LOW,
        },
    }
