"""Institution-facing dashboard data.

Aggregates the transactions and ghost_containers tables into the metrics the
security-team console renders: threats blocked, fraud prevented in ₦, risk
distribution, monthly threat trend, Shield latency, and a paginated
transaction log with full signal breakdowns.

Every endpoint is tenant-scoped by the `institution` query parameter, which the
dashboard sends from its logged-in session. A tenant never sees another
institution's transactions.
"""
import csv
import io
import re
from datetime import datetime, timezone

from fastapi import APIRouter, HTTPException, Query, Request
from fastapi.responses import StreamingResponse

from core.db import cursor, loads, row_to_dict
from core.tenancy import tenant_for_console
from intelligence.context import (
    CHANNEL_LABELS,
    channel_breakdown,
    institution_summary,
    scam_pattern_breakdown,
    signal_frequency,
    tenant_clause,
)
from intelligence.context import (
    fraud_prevented as fraud_prevented_for,
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
def stats(request: Request, institution: str | None = Query(None)):
    institution = tenant_for_console(request)
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
    # The same figure as the Overview, Intelligence, Compliance and Copilot.
    fraud_prevented = fraud_prevented_for(institution)

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


_DATE = re.compile(r"^\d{4}-\d{2}-\d{2}$")

# One column list for every console view of a transaction, so the table, the
# review queue and the CSV can never disagree about what a row contains. A
# flagged or blocked row with no review state yet is an open case.
TXN_COLUMNS = """id, user_id, amount, recipient_id, recipient_name, recipient_account,
                 recipient_bank, narration, channel, device_fingerprint, risk_score,
                 risk_level, action_taken, shield_signals, latency_ms, created_at, status,
                 explanation,
                 CASE WHEN action_taken IN ('FLAG','BLOCK')
                      THEN COALESCE(review_state, 'open') END AS review_state,
                 review_outcome, assignee, reviewed_by, reviewed_at"""


def txn_filters(
    institution: str,
    *,
    action: str | None = None,
    user: str | None = None,
    date_from: str | None = None,
    date_to: str | None = None,
) -> tuple[str, list]:
    """WHERE clause and params shared by the console's transaction reads.

    Dates are whole days (YYYY-MM-DD), inclusive at both ends, compared against
    the stored UTC timestamp. Anything else is a 400 rather than a silent
    no-op, so a malformed range can't quietly export everything.
    """
    if not institution:
        raise HTTPException(status_code=401, detail="No institution.")
    where = "WHERE institution_id = ?"
    params: list = [institution]
    if action:
        actions = [a.strip().upper() for a in action.split(",") if a.strip()]
        if not set(actions) <= {"PASS", "FLAG", "BLOCK"}:
            raise HTTPException(status_code=400, detail="action must be PASS, FLAG or BLOCK.")
        where += f" AND action_taken IN ({','.join('?' * len(actions))})"
        params += actions
    if user:
        where += " AND user_id = ?"
        params.append(user)
    for value, op in ((date_from, ">="), (date_to, "<=")):
        if value:
            if not _DATE.match(value):
                raise HTTPException(status_code=400, detail="Dates must be YYYY-MM-DD.")
            where += f" AND date(created_at) {op} ?"
            params.append(value)
    return where, params


def shape_rows(rows: list[dict], institution: str | None = None) -> list[dict]:
    """Decode signals and attach the customer's name and the bank's own reference.

    Names come from the bank's customers table. They used to come from a set of
    built-in demo personas, so any customer outside those had no name at all.
    """
    from core import customers

    inst = institution or next((r.get("institution_id") for r in rows if r.get("institution_id")), None)
    known = customers.names(inst, [r.get("user_id") for r in rows]) if inst else {}
    for r in rows:
        r["signals"] = loads(r.pop("shield_signals", None), [])
        who = known.get(r.get("user_id")) or {}
        r["customer_name"] = who.get("name")
        r["customer_ref"] = who.get("ref")
    return rows


@router.get("/transactions")
def transactions(
    request: Request,
    limit: int = Query(25, ge=1, le=200),
    offset: int = Query(0, ge=0),
    action: str | None = Query(None),
    institution: str | None = Query(None),
    user: str | None = Query(None),
    date_from: str | None = Query(None, alias="from"),
    date_to: str | None = Query(None, alias="to"),
):
    institution = tenant_for_console(request)
    where, params = txn_filters(institution, action=action, user=user, date_from=date_from, date_to=date_to)

    with cursor() as cur:
        cur.execute(f"SELECT COUNT(*) AS n FROM transactions {where}", params)
        total = cur.fetchone()["n"]

        cur.execute(
            f"SELECT {TXN_COLUMNS} FROM transactions {where} ORDER BY created_at DESC LIMIT ? OFFSET ?",
            params + [limit, offset],
        )
        rows = shape_rows([row_to_dict(r) for r in cur.fetchall()], institution)

    return {"total": total, "limit": limit, "offset": offset, "transactions": rows}


def _csv_response(filename: str, header: list[str], rows) -> StreamingResponse:
    """Stream a CSV without holding the whole export in memory."""

    def generate():
        buf = io.StringIO()
        writer = csv.writer(buf)
        writer.writerow(header)
        yield buf.getvalue()
        for row in rows:
            buf.seek(0)
            buf.truncate(0)
            # A cell starting with = + - @ is executed as a formula by Excel and
            # Sheets. Narrations and names are customer-controlled text, so they
            # are neutralised rather than exported raw.
            writer.writerow(
                ["'" + v if isinstance(v, str) and v[:1] in ("=", "+", "-", "@") else v for v in row]
            )
            yield buf.getvalue()

    return StreamingResponse(
        generate(),
        media_type="text/csv",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@router.get("/export/transactions.csv")
def export_transactions(
    request: Request,
    action: str | None = Query(None),
    date_from: str | None = Query(None, alias="from"),
    date_to: str | None = Query(None, alias="to"),
):
    institution = tenant_for_console(request)
    where, params = txn_filters(institution, action=action, date_from=date_from, date_to=date_to)
    with cursor() as cur:
        cur.execute(
            f"SELECT {TXN_COLUMNS} FROM transactions {where} ORDER BY created_at DESC LIMIT 50000",
            params,
        )
        rows = shape_rows([row_to_dict(r) for r in cur.fetchall()], institution)

    header = [
        "id", "created_at_utc", "customer_id", "customer_name", "amount_ngn", "recipient_name",
        "recipient_account", "recipient_bank", "channel", "narration", "risk_score", "decision",
        "status", "review_state", "review_outcome", "reviewed_by", "signals", "explanation",
    ]
    out = (
        [
            r["id"], r["created_at"], r.get("user_id"), r.get("customer_name"), r["amount"],
            r.get("recipient_name") or r.get("recipient_id"), r.get("recipient_account"),
            r.get("recipient_bank"), r.get("channel"), r.get("narration"), r.get("risk_score"),
            r.get("action_taken"), r.get("status"), r.get("review_state"), r.get("review_outcome"),
            r.get("reviewed_by"), " | ".join(str(s) for s in r.get("signals") or []), r.get("explanation"),
        ]
        for r in rows
    )
    stamp = datetime.now(timezone.utc).strftime("%Y%m%d")
    return _csv_response(f"fable-transactions-{institution}-{stamp}.csv", header, out)


@router.get("/export/audit.csv")
def export_audit(
    request: Request,
    date_from: str | None = Query(None, alias="from"),
    date_to: str | None = Query(None, alias="to"),
):
    institution = tenant_for_console(request)
    where = "WHERE (institution_id = ? OR institution_id IS NULL)"
    params: list = [institution]
    for value, op in ((date_from, ">="), (date_to, "<=")):
        if value:
            if not _DATE.match(value):
                raise HTTPException(status_code=400, detail="Dates must be YYYY-MM-DD.")
            where += f" AND date(created_at) {op} ?"
            params.append(value)
    with cursor() as cur:
        cur.execute(
            f"SELECT id, created_at, event_type, user_id, payload FROM audit_log {where} ORDER BY id DESC LIMIT 50000",
            params,
        )
        rows = [row_to_dict(r) for r in cur.fetchall()]

    out = ([r["id"], r["created_at"], r["event_type"], r.get("user_id"), r.get("payload") or ""] for r in rows)
    stamp = datetime.now(timezone.utc).strftime("%Y%m%d")
    return _csv_response(
        f"fable-audit-{institution}-{stamp}.csv",
        ["id", "created_at_utc", "event", "subject", "details_json"],
        out,
    )


@router.get("/alerts")
def alerts(request: Request, limit: int = Query(50, ge=1, le=200), institution: str | None = Query(None)):
    institution = tenant_for_console(request)
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
def intelligence(request: Request, institution: str | None = Query(None)):
    institution = tenant_for_console(request)
    """Intelligence screen: scam-pattern library usage, channel risk, and
    which Shield signals fire most often."""
    return {
        "summary": institution_summary(institution),
        "scam_patterns": scam_pattern_breakdown(institution),
        "channels": channel_breakdown(institution),
        "signals": signal_frequency(institution),
    }


@router.get("/compliance")
def compliance(request: Request, institution: str | None = Query(None)):
    institution = tenant_for_console(request)
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

    # The real audit trail, not just counts derived from the transactions
    # table. `audit_log` existed since the first schema and had never had a row
    # written to it, so this page cited FATF typologies while the one table that
    # would substantiate any of it was empty.
    from services import audit

    events = audit.recent(institution, limit=50)

    return {
        "audit": {
            "transactions_logged": s["transactions_analyzed"],
            "ghost_containers": ghost_total,
            "ghost_cancelled": ghost_cancelled,
            "decisions_explained": s["blocked"] + s["flagged"],
            "events_recorded": len(events),
        },
        "audit_trail": events,
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


@router.get("/report")
def report(
    request: Request,
    date_from: str | None = Query(None, alias="from"),
    date_to: str | None = Query(None, alias="to"),
):
    """A board-level summary of one period, every figure computed on the server.

    The console's live feed only holds the latest 200 transfers, which is fine
    for a screen and wrong for a report: a month at a real bank is far more
    than that. Everything here is aggregated in SQL over the whole range.

    "Money kept from fraud" uses the same rule as fraud_prevented(): a transfer
    Shield did not pass that ended up blocked, cancelled or still held.
    """
    from services import audit

    institution = tenant_for_console(request)
    where, params = txn_filters(institution, date_from=date_from, date_to=date_to)

    with cursor() as cur:
        cur.execute(
            f"""SELECT action_taken AS a, COUNT(*) AS n, COALESCE(SUM(amount), 0) AS amt
                FROM transactions {where} GROUP BY action_taken""",
            params,
        )
        by_action = {(r["a"] or "PASS"): {"count": r["n"], "amount": r["amt"]} for r in cur.fetchall()}

        cur.execute(
            f"""SELECT COALESCE(SUM(amount), 0) AS amt, COUNT(*) AS n FROM transactions {where}
                AND action_taken IN ('BLOCK', 'FLAG')
                AND COALESCE(status, CASE action_taken WHEN 'BLOCK' THEN 'blocked' ELSE 'flagged' END)
                    IN ('blocked', 'cancelled', 'held')""",
            params,
        )
        kept = row_to_dict(cur.fetchone())

        cur.execute(
            f"""SELECT CASE WHEN action_taken IN ('FLAG','BLOCK') THEN COALESCE(review_state, 'open') END AS s,
                       review_outcome AS o, COUNT(*) AS n
                FROM transactions {where} AND action_taken IN ('FLAG','BLOCK')
                GROUP BY s, o""",
            params,
        )
        reviews = {"open": 0, "in_review": 0, "escalated": 0, "resolved": 0, "fraud": 0, "legitimate": 0}
        for r in cur.fetchall():
            reviews[r["s"]] = reviews.get(r["s"], 0) + r["n"]
            if r["o"]:
                reviews[r["o"]] += r["n"]

        cur.execute(
            f"SELECT decision_ms FROM transactions {where} AND decision_ms IS NOT NULL ORDER BY decision_ms ASC",
            params,
        )
        latencies = [r["decision_ms"] for r in cur.fetchall()]

        cur.execute(
            f"""SELECT channel, COUNT(*) AS n,
                       SUM(CASE WHEN action_taken IN ('FLAG','BLOCK') THEN 1 ELSE 0 END) AS risky
                FROM transactions {where} GROUP BY channel ORDER BY n DESC""",
            params,
        )
        channels = [
            {"label": CHANNEL_LABELS.get(r["channel"], r["channel"] or "Unknown"), "total": r["n"], "risky": r["risky"]}
            for r in cur.fetchall()
        ]

        cur.execute(f"SELECT shield_signals FROM transactions {where} AND action_taken IN ('FLAG','BLOCK')", params)
        signal_counts: dict[str, int] = {}
        for r in cur.fetchall():
            for raw in loads(r["shield_signals"], []) or []:
                code = str(raw).split(":", 1)[0].strip()
                if code:
                    signal_counts[code] = signal_counts.get(code, 0) + 1

        audit_where = "WHERE (institution_id = ? OR institution_id IS NULL)"
        audit_params: list = [institution]
        for value, op in ((date_from, ">="), (date_to, "<=")):
            if value:
                audit_where += f" AND date(created_at) {op} ?"
                audit_params.append(value)
        cur.execute(
            f"SELECT event_type, COUNT(*) AS n FROM audit_log {audit_where} GROUP BY event_type",
            audit_params,
        )
        events = {r["event_type"]: r["n"] for r in cur.fetchall()}

        cur.execute("SELECT name FROM institutions WHERE institution_id = ?", (institution,))
        inst_row = cur.fetchone()

    from services import policy

    total = sum(v["count"] for v in by_action.values())
    blocked = by_action.get("BLOCK", {"count": 0, "amount": 0})
    flagged = by_action.get("FLAG", {"count": 0, "amount": 0})
    passed = by_action.get("PASS", {"count": 0, "amount": 0})
    reviewed = reviews["fraud"] + reviews["legitimate"]

    from intelligence.context import signal_label

    top_signals = sorted(signal_counts.items(), key=lambda kv: kv[1], reverse=True)[:6]
    return {
        "institution": {"id": institution, "name": inst_row["name"] if inst_row else institution},
        "period": {"from": date_from, "to": date_to},
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "volume": {
            "transactions": total,
            "value_ngn": sum(v["amount"] for v in by_action.values()),
            "passed": passed["count"],
            "flagged": flagged["count"],
            "blocked": blocked["count"],
            "frictionless_rate": round(passed["count"] / total, 4) if total else None,
        },
        "protection": {
            "kept_from_fraud_ngn": kept["amt"] or 0,
            "transfers_stopped": kept["n"] or 0,
            "blocked_value_ngn": blocked["amount"],
        },
        "review": {
            **reviews,
            "reviewed": reviewed,
            # Of the flags and blocks a person has looked at, how many were real.
            # None until someone has reviewed something, rather than a made-up rate.
            "precision": round(reviews["fraud"] / reviewed, 4) if reviewed else None,
        },
        "latency_ms": _percentiles(latencies),
        "channels": channels,
        "top_signals": [{"code": c, "label": signal_label(c), "count": n} for c, n in top_signals],
        "controls": {
            "identity_checks_passed": events.get(audit.STEPUP_PASSED, 0),
            "identity_checks_failed": events.get(audit.STEPUP_FAILED, 0),
            "holds_created": events.get(audit.CONTAINMENT_CREATED, 0),
            "holds_cancelled": events.get(audit.CONTAINMENT_CANCELLED, 0) + events.get(audit.CONTAINMENT_EXPIRED, 0),
            "policy_changes": events.get(audit.POLICY_CHANGED, 0),
            "team_changes": sum(events.get(e, 0) for e in (audit.TEAM_INVITED, audit.TEAM_ROLE_CHANGED, audit.TEAM_REMOVED)),
            "key_rotations": events.get(audit.KEY_ROTATED, 0),
        },
        "policy": policy.effective(institution),
    }

