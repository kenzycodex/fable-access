"""Shared institution-intelligence aggregations.

Read-only rollups over the transactions + ghost_containers tables, used by the
dashboard data endpoints and to ground the Copilot assistant's answers in the
institution's real numbers (so the LLM never hallucinates a stat).
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


def institution_summary() -> dict:
    """Headline counts + money-protected for the whole institution."""
    with cursor() as cur:
        cur.execute("SELECT COUNT(*) AS n FROM transactions")
        total = cur.fetchone()["n"]

        cur.execute("SELECT action_taken AS a, COUNT(*) AS n FROM transactions GROUP BY action_taken")
        by_action = {(r["a"] or "PASS"): r["n"] for r in cur.fetchall()}

        cur.execute("SELECT AVG(risk_score) AS s FROM transactions")
        avg_score = cur.fetchone()["s"] or 0.0

        cur.execute(
            "SELECT COALESCE(SUM(amount),0) AS amt FROM ghost_containers WHERE status = 'CANCELLED'"
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


def scam_pattern_breakdown() -> list[dict]:
    """How often each Nigerian scam pattern fired, most frequent first."""
    counts: dict[str, int] = {}
    with cursor() as cur:
        cur.execute("SELECT shield_signals FROM transactions WHERE action_taken IN ('BLOCK','FLAG')")
        for row in cur.fetchall():
            for sig in loads(row["shield_signals"], []) or []:
                if isinstance(sig, str) and sig.startswith("scam_pattern:"):
                    name = sig.split(":", 1)[1].strip()
                    counts[name] = counts.get(name, 0) + 1
    return sorted(
        ({"name": k, "label": PATTERN_LABELS.get(k, k.replace("_", " ").title()), "count": v}
         for k, v in counts.items()),
        key=lambda d: d["count"],
        reverse=True,
    )


def channel_breakdown() -> list[dict]:
    """Volume + risk rate per channel."""
    with cursor() as cur:
        cur.execute(
            """SELECT channel,
                      COUNT(*) AS total,
                      SUM(CASE WHEN action_taken IN ('BLOCK','FLAG') THEN 1 ELSE 0 END) AS risky
               FROM transactions GROUP BY channel ORDER BY total DESC"""
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


def signal_frequency() -> list[dict]:
    """How often each Shield signal type fired across flagged/blocked transfers."""
    labels = {
        "amount_anomaly": "Amount anomaly",
        "new_recipient": "New recipient",
        "time_anomaly": "Unusual time",
        "channel_risk": "Higher-risk channel",
        "scam_pattern": "Scam-script match",
        "ml_anomaly": "Behavioral anomaly",
    }
    counts: dict[str, int] = {}
    with cursor() as cur:
        cur.execute("SELECT shield_signals FROM transactions WHERE action_taken IN ('BLOCK','FLAG')")
        for row in cur.fetchall():
            for sig in loads(row["shield_signals"], []) or []:
                if isinstance(sig, str):
                    code = sig.split(":", 1)[0].strip()
                    code = "nip_code" if code.startswith("nip_") else code
                    key = labels.get(code, code.replace("_", " ").title())
                    counts[key] = counts.get(key, 0) + 1
    return sorted(({"label": k, "count": v} for k, v in counts.items()), key=lambda d: d["count"], reverse=True)


def grounding_text() -> str:
    """Compact real-numbers brief injected into the assistant's system prompt."""
    s = institution_summary()
    patterns = scam_pattern_breakdown()[:5]
    channels = channel_breakdown()[:5]
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
