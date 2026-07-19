"""Shared institution-intelligence aggregations.

Read-only rollups over the transactions + ghost_containers tables, used by the
dashboard data endpoints and to ground the Copilot assistant's answers in the
institution's real numbers (so the LLM never hallucinates a stat).

Every rollup is tenant-scoped: pass the institution_id of the logged-in
dashboard session and the numbers cover only that institution's feed. Passing
None aggregates across all tenants, which is only appropriate for internal
operator views, never for a customer-facing dashboard.
"""
from db import cursor, loads

CHANNEL_LABELS = {
    "mobile_app": "Mobile App",
    "ussd": "USSD",
    "internet": "Web",
    "pos": "POS",
    "atm": "ATM",
    "qr": "QR",
    "branch": "Branch",
    "unknown": "Unknown",
}

# Human labels for the raw scam-pattern signal codes Shield records.
PATTERN_LABELS = {
    "urgency_pidgin": "Urgency (Pidgin)",
    "urgency_english": "Urgency keyword",
    "family_impersonation": "Family impersonation",
    "investment_fraud": "Investment fraud",
    "fake_alert": "Fake alert",
    "account_blocked": "Account-block scam",
    "supplier_fraud": "Supplier account-change",
    "sika_gari_419": "Advance-fee (419)",
}


def tenant_clause(institution_id: str | None, prefix: str = "WHERE") -> tuple[str, list]:
    """SQL fragment + params restricting a query to one institution."""
    if not institution_id:
        return "", []
    return f" {prefix} institution_id = ?", [institution_id]


def institution_summary(institution_id: str | None = None) -> dict:
    """Headline counts + money-protected for one institution."""
    where, params = tenant_clause(institution_id)
    with cursor() as cur:
        cur.execute(f"SELECT COUNT(*) AS n FROM transactions{where}", params)
        total = cur.fetchone()["n"]

        cur.execute(
            f"SELECT action_taken AS a, COUNT(*) AS n FROM transactions{where} GROUP BY action_taken",
            params,
        )
        by_action = {(r["a"] or "PASS"): r["n"] for r in cur.fetchall()}

        cur.execute(f"SELECT AVG(risk_score) AS s FROM transactions{where}", params)
        avg_score = cur.fetchone()["s"] or 0.0

        ghost_where, ghost_params = tenant_clause(institution_id, prefix="AND")
        cur.execute(
            "SELECT COALESCE(SUM(amount),0) AS amt FROM ghost_containers "
            f"WHERE status = 'CANCELLED'{ghost_where}",
            ghost_params,
        )
        fraud_prevented = cur.fetchone()["amt"] or 0

    return {
        "transactions_analyzed": total,
        "blocked": by_action.get("BLOCK", 0),
        "flagged": by_action.get("FLAG", 0),
        "passed": by_action.get("PASS", 0),
        "avg_risk_score": round(avg_score, 3),
        "fraud_prevented_ngn": fraud_prevented,
    }


def _risky_signals(institution_id: str | None):
    """Signal lists from every flagged/blocked transfer in the tenant."""
    where, params = tenant_clause(institution_id, prefix="AND")
    with cursor() as cur:
        cur.execute(
            f"SELECT shield_signals FROM transactions WHERE action_taken IN ('BLOCK','FLAG'){where}",
            params,
        )
        for row in cur.fetchall():
            yield loads(row["shield_signals"], []) or []


def scam_pattern_breakdown(institution_id: str | None = None) -> list[dict]:
    """How often each Nigerian scam pattern fired, most frequent first."""
    counts: dict[str, int] = {}
    for signals in _risky_signals(institution_id):
        for sig in signals:
            if isinstance(sig, str) and sig.startswith("scam_pattern:"):
                # Signals carry an inline weight, e.g. "scam_pattern: urgency_pidgin (+0.16)"
                name = sig.split(":", 1)[1].strip().split(" (")[0].strip()
                counts[name] = counts.get(name, 0) + 1
    return sorted(
        ({"name": k, "label": PATTERN_LABELS.get(k, k.replace("_", " ").title()), "count": v}
         for k, v in counts.items()),
        key=lambda d: d["count"],
        reverse=True,
    )


def channel_breakdown(institution_id: str | None = None) -> list[dict]:
    """Volume + risk rate per channel."""
    where, params = tenant_clause(institution_id)
    with cursor() as cur:
        cur.execute(
            f"""SELECT channel,
                      COUNT(*) AS total,
                      SUM(CASE WHEN action_taken IN ('BLOCK','FLAG') THEN 1 ELSE 0 END) AS risky
               FROM transactions{where} GROUP BY channel ORDER BY total DESC""",
            params,
        )
        rows = cur.fetchall()
    out = []
    for r in rows:
        total = r["total"] or 0
        risky = r["risky"] or 0
        out.append({
            "channel": r["channel"] or "unknown",
            "label": CHANNEL_LABELS.get(r["channel"] or "unknown", r["channel"] or "Unknown"),
            "total": total,
            "risky": risky,
            "risk_rate": round(risky / total, 3) if total else 0.0,
        })
    return out


def signal_frequency(institution_id: str | None = None) -> list[dict]:
    """How often each Shield signal type fired across flagged/blocked transfers."""
    labels = {
        "amount_anomaly": "Amount anomaly",
        "new_recipient": "New recipient",
        "time_anomaly": "Unusual time",
        "channel_risk": "Higher-risk channel",
        "scam_pattern": "Scam-script match",
        "ml_anomaly": "ML anomaly",
        "device_anomaly": "Unrecognized device",
        "location_anomaly": "Location anomaly",
        "session_freshness": "Fresh session",
        "behavioral_anomaly": "Behavioral anomaly",
        "timezone_mismatch": "Timezone mismatch",
    }
    counts: dict[str, int] = {}
    for signals in _risky_signals(institution_id):
        for sig in signals:
            if isinstance(sig, str):
                code = sig.split(":", 1)[0].strip()
                code = "nip_code" if code.startswith("nip_") else code
                key = labels.get(code, code.replace("_", " ").title())
                counts[key] = counts.get(key, 0) + 1
    return sorted(({"label": k, "count": v} for k, v in counts.items()), key=lambda d: d["count"], reverse=True)


def grounding_text(institution_id: str | None = None) -> str:
    """Compact real-numbers brief injected into the assistant's system prompt."""
    s = institution_summary(institution_id)
    patterns = scam_pattern_breakdown(institution_id)[:5]
    channels = channel_breakdown(institution_id)[:5]
    lines = [
        f"Transactions analyzed: {s['transactions_analyzed']}",
        f"Blocked (high risk): {s['blocked']} | Flagged (medium): {s['flagged']} | Passed: {s['passed']}",
        f"Average risk score: {s['avg_risk_score']}",
        f"Fraud prevented (Ghost cancellations): NGN {s['fraud_prevented_ngn']:,.0f}",
    ]
    if patterns:
        lines.append("Top scam patterns: " + ", ".join(f"{p['label']} ({p['count']})" for p in patterns))
    if channels:
        lines.append("Channels by volume: " + ", ".join(f"{c['label']} {c['total']} ({int(c['risk_rate']*100)}% risky)" for c in channels))
    return "\n".join(lines)
