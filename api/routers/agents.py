"""Agent-level analytics for the institution dashboard's Agents section.

Lets a risk team see each Fable agent as an operational unit: what Copilot has
learned per customer, how Shield's signals are deciding, and what Ghost has
contained — all straight from SQLite, no synthetic numbers. Each agent's status
is real: Ghost reads "off" when the institution switched it off and "degraded"
when hold expiry has stopped running or its webhooks are failing.
"""
from datetime import datetime, timezone

from fastapi import APIRouter, Query, Request

from services import policy


def _thresholds(institution: str) -> dict:
    """The base cutoffs in force for this institution: its own, or Fable's."""
    p = policy.effective(institution)
    return {"block": p["block_threshold"], "flag": p["flag_threshold"]}


def _cooling(institution: str) -> dict:
    p = policy.effective(institution)
    return {
        "high_risk_minutes": p["hold_high_minutes"],
        "medium_risk_minutes": p["hold_medium_minutes"],
        "low_risk_minutes": p["hold_low_minutes"],
    }

from agents.copilot.baseline import COLD_START_PREMIUM, format_hours, get_user_baseline
from core import engine_config
from core.db import cursor, loads, row_to_dict
from core.tenancy import tenant_for_console
from intelligence.context import tenant_clause

router = APIRouter(prefix="/v1/agents", tags=["agents"])


def _ghost_status(institution: str | None) -> dict:
    """Whether Ghost is doing its job for this institution right now."""
    from core.tenancy import disabled_agents
    from services import scheduler

    if "ghost" in disabled_agents(institution):
        return {"status": "off", "detail": "Switched off for your institution."}
    sched = scheduler.status()
    if sched["enabled"] and "ghost_expiry" in sched["stale"]:
        return {"status": "degraded", "detail": "Hold expiry has not run recently. Holds may outlive their window."}
    try:
        with cursor() as cur:
            cur.execute(
                "SELECT COUNT(*) AS n FROM webhook_outbox WHERE institution_id = ? AND status = 'failed' "
                "AND event LIKE 'containment.%' AND created_at >= datetime('now', '-1 day')",
                (institution,),
            )
            failed = cur.fetchone()["n"]
    except Exception:  # noqa: BLE001 - no outbox table on a very old database
        failed = 0
    if failed:
        return {"status": "degraded",
                "detail": f"{failed} hold update{'s' if failed != 1 else ''} could not be delivered to your webhook today."}
    return {"status": "active", "detail": ""}


# The Shield pipeline, as the dashboard renders it: every signal, in the order
# the analyzer adds them, with the most each can add under the engine version
# in force (not a hardcoded copy that drifts from the weights).
_PIPELINE = [
    ("amount_anomaly", "Amount anomaly", lambda w: w["amount_50x"],
     "How far above the customer's own normal: tiers from 3x up to 50x."),
    ("cold_start", "No history yet", lambda w: COLD_START_PREMIUM,
     "A customer without three past transfers is judged against this bank's customers as a whole."),
    ("first_transfer_amount", "First transfer amount", lambda w: w["first_amount_20m"],
     "With no history to compare, the amount itself is priced in tiers from NGN 100k to NGN 20m."),
    ("new_recipient", "New recipient", lambda w: w["new_recipient"],
     "First transfer to this account in the customer's remembered history."),
    ("time_anomaly", "Unusual time", lambda w: w["time_anomaly"],
     "Device-local hour outside the customer's usual hours."),
    ("channel_risk", "Channel risk", lambda w: max(v for k, v in w.items() if k.startswith("channel_")),
     "Weights per channel informed by NIBSS fraud data: internet banking highest, branch lowest."),
    ("nip_code", "NIP response code", lambda w: 0.95,
     "NIBSS instant-payment risk codes from the bank's own rail; code 34 always blocks."),
    ("scam_pattern", "Scam script (narration)", lambda w: _scam_max(),
     "English and Pidgin scam-script matching, deliberately halved: most customers leave narration blank."),
    ("ml_anomaly", "Unusual for this customer", lambda w: max(w.get("ml_anomaly", 0), w.get("ml_anomaly_previous", 0)),
     "How far the amount and hour together sit from the customer's own past transfers."),
    ("device_anomaly", "Unrecognised device", lambda w: w["device_anomaly_large"],
     "A device fingerprint the customer has not used before; more for a large transfer."),
    ("location_anomaly", "Location", lambda w: max(w["location_country"], w["location_city_large"], w["location_city"]),
     "A new city, or outside the home country."),
    ("session_freshness", "Fresh session", lambda w: w["session_freshness"],
     "A large transfer seconds after signing in."),
    ("behavioral_anomaly", "Pasted and rushed", lambda w: w["behavioral_paste"] + w["behavioral_fast"],
     "Account number pasted, and submitted with almost no hesitation, on a large amount."),
    ("timezone_mismatch", "Timezone mismatch", lambda w: w["timezone_mismatch"],
     "The device's timezone differs from the customer's usual one."),
    ("failed_verification", "Failed checks", lambda w: w["failed_verification_high"],
     "Recent failed PIN, passkey or code attempts."),
    ("velocity", "Burst of transfers", lambda w: w["velocity_high"],
     "Several live transfers in a few minutes."),
]


def _scam_max() -> float:
    from agents.shield.analyzer import NARRATION_WEIGHT_SCALE
    from agents.shield.patterns import NIGERIAN_SCAM_PATTERNS

    top = max((p["risk_weight"] for p in NIGERIAN_SCAM_PATTERNS), default=0.0)
    return round(top * NARRATION_WEIGHT_SCALE, 3)


def shield_pipeline() -> list[dict]:
    w = engine_config.active()["params"]["weights"]
    out = []
    for i, (code, label, top, description) in enumerate(_PIPELINE, start=1):
        out.append({"step": i, "code": code, "label": label, "max_weight": round(float(top(w)), 3),
                    "description": description})
    return out



@router.get("/overview")
def overview(request: Request, institution: str | None = Query(None)):
    institution = tenant_for_console(request)
    where, params = tenant_clause(institution)
    and_where, and_params = tenant_clause(institution, prefix="AND")

    with cursor() as cur:
        cur.execute(f"SELECT COUNT(*) AS n FROM transactions{where}", params)
        total_tx = cur.fetchone()["n"]

        cur.execute(f"SELECT COUNT(*) AS n FROM transactions WHERE is_seed = 0{and_where}", and_params)
        live_tx = cur.fetchone()["n"]

        cur.execute(f"SELECT action_taken AS a, COUNT(*) AS n FROM transactions{where} GROUP BY action_taken", params)
        by_action = {r["a"] or "PASS": r["n"] for r in cur.fetchall()}

        cur.execute(f"SELECT AVG(risk_score) AS s FROM transactions{where}", params)
        avg_score = cur.fetchone()["s"] or 0.0

        cur.execute(f"SELECT COUNT(DISTINCT user_id) AS n FROM transactions{where}", params)
        users = cur.fetchone()["n"]

        # Devices and locations belong to the tenant's own customers, so scope
        # them through the transactions table rather than counting globally.
        cur.execute(
            f"""SELECT COUNT(*) AS n FROM customer_devices
                WHERE user_id IN (SELECT DISTINCT user_id FROM transactions{where})""",
            params,
        )
        devices = cur.fetchone()["n"]

        cur.execute(
            f"""SELECT COUNT(*) AS n FROM user_locations
                WHERE user_id IN (SELECT DISTINCT user_id FROM transactions{where})""",
            params,
        )
        locations = cur.fetchone()["n"]

        cur.execute(f"SELECT MAX(created_at) AS t FROM transactions WHERE is_seed = 0{and_where}", and_params)
        last_live = cur.fetchone()["t"]

        cur.execute(
            f"SELECT status, COUNT(*) AS n, COALESCE(SUM(amount),0) AS amt FROM ghost_containers{where} GROUP BY status",
            params,
        )
        ghost_rows = {r["status"]: {"count": r["n"], "amount": r["amt"]} for r in cur.fetchall()}

    blocked = by_action.get("BLOCK", 0)
    flagged = by_action.get("FLAG", 0)
    passed = by_action.get("PASS", 0)
    ghost_created = sum(g["count"] for g in ghost_rows.values())
    ghost_cancelled = ghost_rows.get("CANCELLED", {}).get("count", 0)
    ghost_expired = ghost_rows.get("EXPIRED", {}).get("count", 0)
    ghost = _ghost_status(institution)

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
            "signal_layers": len(_PIPELINE),
            "thresholds": _thresholds(institution),
        },
        "ghost": {
            "status": ghost["status"],
            "detail": ghost["detail"],
            "containers_created": ghost_created,
            "cancelled": ghost_cancelled,
            "expired": ghost_expired,
            "released": ghost_rows.get("RELEASED", {}).get("count", 0),
            "held": ghost_rows.get("HELD", {}).get("count", 0) + ghost_rows.get("RELEASE_REQUESTED", {}).get("count", 0),
            "cancellation_rate": round(ghost_cancelled / ghost_created, 4) if ghost_created else 0,
            # Money that stayed with the customer: cancelled, or nobody released it.
            "money_saved_ngn": ghost_rows.get("CANCELLED", {}).get("amount", 0)
            + ghost_rows.get("EXPIRED", {}).get("amount", 0),
        },
        "watch": {
            "status": "planned",
            "description": "Monitoring between transfers. Planned, not built.",
        },
        "generated_at": datetime.now(timezone.utc).isoformat(),
    }


@router.get("/copilot/customers")
def copilot_customers(request: Request, limit: int = Query(50, ge=1, le=200), institution: str | None = Query(None)):
    institution = tenant_for_console(request)
    """Per-customer view of what Copilot has actually learned."""
    where, params = tenant_clause(institution)
    with cursor() as cur:
        cur.execute(
            # Imported history counts too, so a customer imported with past
            # transfers shows the baseline they already have.
            f"""SELECT user_id, COUNT(*) AS tx, SUM(origin = 'live') AS live_tx, MAX(created_at) AS last_seen
               FROM customer_history{where} GROUP BY user_id ORDER BY tx DESC LIMIT ?""",
            params + [limit],
        )
        users = [row_to_dict(r) for r in cur.fetchall()]

    # What the console needs to support a customer, read in one pass: whether
    # they have a PIN, whether it is locked, which factors they have enrolled,
    # and what they hold. Read-only on purpose. Asking the ledger for a balance
    # would create an account row for anyone it had not seen.
    from core import security

    with cursor() as cur:
        ids = [u["user_id"] for u in users]
        balances: dict[str, float] = {}
        if ids:
            marks = ",".join("?" for _ in ids)
            cur.execute(f"SELECT user_id, balance FROM accounts WHERE user_id IN ({marks})", ids)
            balances = {r["user_id"]: float(r["balance"] or 0) for r in cur.fetchall()}

    def verification(user_id: str) -> dict:
        st = security.status(user_id)
        return {
            "pin_set": st["pin_set"],
            "pin_locked": st["pin_locked"],
            "passkeys": st["passkey_count"],
            "contact_set": st["email_set"] or st["phone_set"],
            "two_factor": st["two_factor_enabled"],
        }

    out = []
    for u in users:
        extra = {"balance": balances.get(u["user_id"]), "verification": verification(u["user_id"])}
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
                **extra,
            })
        else:
            out.append({
                "user_id": u["user_id"],
                "has_baseline": False,
                "transactions_analyzed": u["tx"],
                "live_transactions": u["live_tx"] or 0,
                "last_activity": u["last_seen"],
                **extra,
            })

    return {"customers": out, "total": len(out)}


@router.get("/shield/decisions")
def shield_decisions(request: Request, limit: int = Query(25, ge=1, le=200), institution: str | None = Query(None)):
    institution = tenant_for_console(request)
    """Recent Shield decisions with full signal breakdowns + the pipeline config."""
    where, params = tenant_clause(institution)
    and_where, and_params = tenant_clause(institution, prefix="AND")

    with cursor() as cur:
        cur.execute(
            f"""SELECT id, user_id, amount, recipient_id, recipient_bank, channel,
                      risk_score, risk_level, action_taken, shield_signals, city, country,
                      location_source, auth_method, session_duration_seconds,
                      typing_speed_ms, paste_detected, device_fingerprint, is_seed, created_at
               FROM transactions{where} ORDER BY created_at DESC LIMIT ?""",
            params + [limit],
        )
        rows = [row_to_dict(r) for r in cur.fetchall()]

        cur.execute(f"SELECT COUNT(*) AS n FROM transactions{where}", params)
        total = cur.fetchone()["n"]
        cur.execute(f"SELECT action_taken AS a, COUNT(*) AS n FROM transactions{where} GROUP BY action_taken", params)
        by_action = {r["a"] or "PASS": r["n"] for r in cur.fetchall()}
        # False-positive proxy: FLAG/BLOCK decisions later confirmed legitimate.
        cur.execute(
            "SELECT COUNT(*) AS n FROM transactions WHERE action_taken IN ('FLAG','BLOCK') "
            f"AND confirmed_legitimate = 1 AND is_seed = 0{and_where}",
            and_params,
        )
        fp = cur.fetchone()["n"]

    for r in rows:
        r["signals"] = loads(r.pop("shield_signals"), [])

    friction = by_action.get("FLAG", 0) + by_action.get("BLOCK", 0)
    return {
        "decisions": rows,
        "pipeline": shield_pipeline(),
        "thresholds": _thresholds(institution),
        "accuracy": {
            "transactions_scored": total,
            "pass_rate": round(by_action.get("PASS", 0) / total, 4) if total else 0,
            "friction_events": friction,
            "false_positive_proxy": fp,
        },
    }


@router.get("/ghost/containers")
def ghost_containers(request: Request, limit: int = Query(50, ge=1, le=200), institution: str | None = Query(None)):
    institution = tenant_for_console(request)
    """Container history + resolution stats + cooling-window config."""
    where, params = tenant_clause(institution)
    with cursor() as cur:
        cur.execute(
            f"""SELECT ghost_id, user_id, amount, recipient_id, recipient_account, recipient_bank,
                      status, cooling_window_minutes, risk_score, explanation,
                      created_at, expires_at, resolved_at
               FROM ghost_containers{where} ORDER BY created_at DESC LIMIT ?""",
            params + [limit],
        )
        rows = [row_to_dict(r) for r in cur.fetchall()]

        cur.execute(
            f"SELECT status, COUNT(*) AS n, COALESCE(SUM(amount),0) AS amt FROM ghost_containers{where} GROUP BY status",
            params,
        )
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
        "cooling_windows": _cooling(institution),
    }
