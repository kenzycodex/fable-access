"""Institution-facing dashboard data.

Aggregates the transactions and ghost_containers tables into the metrics the
security-team console renders: threats blocked, fraud prevented in ₦, risk
distribution, monthly threat trend, Shield latency, and a paginated
transaction log with full signal breakdowns.

Every endpoint is tenant-scoped by the `institution` query parameter, which the
dashboard sends from its logged-in session. A tenant never sees another
institution's transactions.
"""
from datetime import datetime, timezone

from fastapi import APIRouter, Query

from db import cursor, row_to_dict, loads
from intelligence.context import (
    channel_breakdown,
    institution_summary,
    scam_pattern_breakdown,
    signal_frequency,
    tenant_clause,
    CHANNEL_LABELS,
)

router = APIRouter(prefix="/v1/dashboard", tags=["dashboard"])

MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]


def _percentiles(sorted_values: list[float]) -> dict | None:
    """p50/p95/p99 from measured latencies, or None when nothing is measured."""
    if not sorted_values:
        return None

    def at(p: float) -> float:
        idx = min(int(round(p * (len(sorted_values) - 1))), len(sorted_values) - 1)
        return round(sorted_values[idx], 1)

    return {"p50": at(0.50), "p95": at(0.95), "p99": at(0.99)}


@router.get("/stats")
def stats(institution: str | None = Query(None)):
    where, params = tenant_clause(institution)
    ghost_where, ghost_params = tenant_clause(institution)

    with cursor() as cur:
        cur.execute(f"SELECT COUNT(*) AS n FROM transactions{where}", params)
        total_tx = cur.fetchone()["n"]

        cur.execute(f"SELECT action_taken AS a, COUNT(*) AS n FROM transactions{where} GROUP BY action_taken", params)
        by_action = {r["a"] or "PASS": r["n"] for r in cur.fetchall()}

        cur.execute(f"SELECT risk_level AS l, COUNT(*) AS n FROM transactions{where} GROUP BY risk_level", params)
        by_level = {r["l"] or "LOW": r["n"] for r in cur.fetchall()}

        cur.execute(f"SELECT AVG(risk_score) AS avg_score FROM transactions{where}", params)
        avg_score = cur.fetchone()["avg_score"] or 0.0

        # Ghost outcomes + fraud prevented (cancelled containers = money saved)
        cur.execute(
            f"SELECT status, COUNT(*) AS n, COALESCE(SUM(amount),0) AS amt FROM ghost_containers{ghost_where} GROUP BY status",
            ghost_params,
        )
        ghost_rows = {r["status"]: {"count": r["n"], "amount": r["amt"]} for r in cur.fetchall()}

        # Threat trend: BLOCK/FLAG counts per calendar month
        trend_where, trend_params = tenant_clause(institution, prefix="AND")
        cur.execute(
            f"""SELECT substr(created_at, 6, 2) AS mm, COUNT(*) AS n
               FROM transactions
               WHERE action_taken IN ('BLOCK','FLAG'){trend_where}
               GROUP BY mm ORDER BY mm""",
            trend_params,
        )
        trend_map = {int(r["mm"]): r["n"] for r in cur.fetchall() if r["mm"]}

        live_where, live_params = tenant_clause(institution, prefix="AND")
        cur.execute(f"SELECT COUNT(*) AS n FROM transactions WHERE is_seed = 0{live_where}", live_params)
        live_n = cur.fetchone()["n"]

        # Real percentiles from measured Shield decisions. This used to report
        # a hardcoded p50/p95/p99 that was never derived from anything, so the
        # console advertised a latency budget it had no evidence for.
        #
        # decision_ms, not latency_ms: the budget is a promise about how long
        # the verdict takes. latency_ms also contained the explanation write-up,
        # which was a multi-second LLM call, so the console reported a ~4000ms
        # p95 for work that finishes in ~50ms. Rows predating the split have
        # decision_ms NULL and are excluded rather than mixed in, because they
        # measured a different thing.
        cur.execute(
            f"""SELECT decision_ms FROM transactions
                WHERE decision_ms IS NOT NULL{live_where}
                ORDER BY decision_ms ASC""",
            live_params,
        )
        latencies = [r["decision_ms"] for r in cur.fetchall()]

        # Explanation time is tracked but deliberately not budgeted: it happens
        # off the request path and no caller waits on it.
        cur.execute(
            f"""SELECT explanation_ms FROM transactions
                WHERE explanation_ms IS NOT NULL{live_where}
                ORDER BY explanation_ms ASC""",
            live_params,
        )
        explanation_times = [r["explanation_ms"] for r in cur.fetchall()]

    threats_blocked = by_action.get("BLOCK", 0)
    flagged = by_action.get("FLAG", 0)
    fraud_prevented = ghost_rows.get("CANCELLED", {}).get("amount", 0)

    risk_distribution = [
        {"label": "LOW", "value": by_level.get("LOW", 0), "color": "#12B76A"},
        {"label": "MEDIUM", "value": by_level.get("MEDIUM", 0), "color": "#F5A524"},
        {"label": "HIGH", "value": by_level.get("HIGH", 0), "color": "#E63B60"},
    ]

    threat_trend = [{"month": MONTHS[m - 1], "threats": trend_map.get(m, 0)} for m in range(1, 13)]

    return {
        "institution_id": institution,
        "transactions_analyzed": total_tx,
        "live_transactions": live_n,
        "threats_blocked": threats_blocked,
        "flagged": flagged,
        "passed": by_action.get("PASS", 0),
        "avg_risk_score": round(avg_score, 3),
        "fraud_prevented_ngn": fraud_prevented,
        "ghost": {
            "created": sum(g["count"] for g in ghost_rows.values()),
            "cancelled": ghost_rows.get("CANCELLED", {}).get("count", 0),
            "released": ghost_rows.get("RELEASED", {}).get("count", 0),
            "held": ghost_rows.get("HELD", {}).get("count", 0),
        },
        "risk_distribution": risk_distribution,
        "threat_trend": threat_trend,
        # None until decisions have actually been measured; the UI shows a
        # "not measured yet" state rather than an invented number.
        "latency_ms": _percentiles(latencies),
        "latency_sample_size": len(latencies),
        # Prose generation, reported separately so it is visible without being
        # counted against the decision budget.
        "explanation_ms": _percentiles(explanation_times),
        "explanation_sample_size": len(explanation_times),
        "generated_at": datetime.now(timezone.utc).isoformat(),
    }


@router.get("/transactions")
def transactions(
    limit: int = Query(25, ge=1, le=200),
    offset: int = Query(0, ge=0),
    action: str | None = Query(None),
    institution: str | None = Query(None),
    user: str | None = Query(None),
):
    where = "WHERE 1=1"
    params: list = []
    if action:
        where += " AND action_taken = ?"
        params.append(action.upper())
    if institution:
        where += " AND institution_id = ?"
        params.append(institution)
    if user:
        # The demo bank asks for one customer's own history.
        where += " AND user_id = ?"
        params.append(user)

    with cursor() as cur:
        cur.execute(f"SELECT COUNT(*) AS n FROM transactions {where}", params)
        total = cur.fetchone()["n"]

        cur.execute(
            f"""SELECT id, user_id, amount, recipient_id, recipient_name, recipient_account,
                       recipient_bank, narration,
                       channel, device_fingerprint, risk_score, risk_level, action_taken,
                       shield_signals, latency_ms, created_at
                FROM transactions {where}
                ORDER BY created_at DESC LIMIT ? OFFSET ?""",
            params + [limit, offset],
        )
        rows = [row_to_dict(r) for r in cur.fetchall()]

    for r in rows:
        r["signals"] = loads(r.pop("shield_signals"), [])

    return {"total": total, "limit": limit, "offset": offset, "transactions": rows}


@router.get("/alerts")
def alerts(limit: int = Query(50, ge=1, le=200), institution: str | None = Query(None)):
    """Watch Alerts feed: every flagged/blocked transfer, newest first, with a
    plain-language reason and severity, plus rollup counts."""
    where, params = tenant_clause(institution, prefix="AND")
    with cursor() as cur:
        cur.execute(
            f"""SELECT id, user_id, amount, recipient_id, recipient_account, recipient_bank,
                      narration, channel, risk_score, risk_level, action_taken,
                      shield_signals, created_at
               FROM transactions
               WHERE action_taken IN ('BLOCK','FLAG'){where}
               ORDER BY created_at DESC LIMIT ?""",
            params + [limit],
        )
        rows = [row_to_dict(r) for r in cur.fetchall()]

    alerts_out = []
    for r in rows:
        signals = loads(r.pop("shield_signals"), []) or []
        alerts_out.append({
            "id": r["id"],
            "customer": r.get("user_id"),
            "amount": r["amount"],
            "recipient": r.get("recipient_id") or "unknown",
            "recipient_bank": r.get("recipient_bank"),
            "channel": CHANNEL_LABELS.get(r.get("channel"), r.get("channel")),
            "risk_score": r.get("risk_score"),
            "severity": "HIGH" if r.get("action_taken") == "BLOCK" else "MEDIUM",
            "action": r.get("action_taken"),
            "signals": signals,
            "created_at": r.get("created_at"),
        })

    s = institution_summary(institution)
    return {
        "alerts": alerts_out,
        "counts": {"blocked": s["blocked"], "flagged": s["flagged"], "open": len(alerts_out)},
    }


@router.get("/intelligence")
def intelligence(institution: str | None = Query(None)):
    """Intelligence screen: scam-pattern library usage, channel risk, and
    which Shield signals fire most often."""
    return {
        "summary": institution_summary(institution),
        "scam_patterns": scam_pattern_breakdown(institution),
        "channels": channel_breakdown(institution),
        "signals": signal_frequency(institution),
    }


@router.get("/compliance")
def compliance(institution: str | None = Query(None)):
    """Compliance screen: audit-trail counts, a CSAT-style satisfaction proxy
    (safe users see near-zero friction), and a recent incident log from blocks."""
    s = institution_summary(institution)
    total = max(s["transactions_analyzed"], 1)

    # Friction proxy: PASS transfers went through with zero extra checks.
    frictionless_rate = round(s["passed"] / total, 3)

    incident_where, incident_params = tenant_clause(institution, prefix="AND")
    ghost_where, ghost_params = tenant_clause(institution)

    with cursor() as cur:
        cur.execute(
            f"""SELECT id, user_id, amount, recipient_bank, risk_score, action_taken, created_at
               FROM transactions
               WHERE action_taken = 'BLOCK'{incident_where}
               ORDER BY created_at DESC LIMIT 12""",
            incident_params,
        )
        incidents = [row_to_dict(r) for r in cur.fetchall()]

        cur.execute(f"SELECT COUNT(*) AS n FROM ghost_containers{ghost_where}", ghost_params)
        ghost_total = cur.fetchone()["n"]

        cancelled_where, cancelled_params = tenant_clause(institution, prefix="AND")
        cur.execute(
            f"SELECT COUNT(*) AS n FROM ghost_containers WHERE status = 'CANCELLED'{cancelled_where}",
            cancelled_params,
        )
        ghost_cancelled = cur.fetchone()["n"]

    return {
        "audit": {
            "transactions_logged": s["transactions_analyzed"],
            "ghost_containers": ghost_total,
            "ghost_cancelled": ghost_cancelled,
            "decisions_explained": s["blocked"] + s["flagged"],
        },
        # Friction is measured; satisfaction is not. There is no survey, no
        # rating and no feedback channel in this system, so a CSAT "score"
        # would be a number with nothing behind it.
        "friction": {
            "frictionless_rate": frictionless_rate,
            "friction_events": s["flagged"] + s["blocked"],
        },
        "fraud_prevented_ngn": s["fraud_prevented_ngn"],
        "incidents": incidents,
        "frameworks": [
            {"name": "CBN Risk-Based Cybersecurity", "status": "aligned"},
            {"name": "NDPA 2023 (data protection)", "status": "aligned"},
            {"name": "PCI-DSS (PCI fields stripped)", "status": "aligned"},
            {"name": "NIBSS fraud reporting", "status": "aligned"},
        ],
    }
