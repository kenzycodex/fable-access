"""What Ask Fable knows about one institution, gathered once per question.

Every figure the assistant quotes, every follow-up it suggests and every answer
it gives without a model comes from this one snapshot, so the three can never
disagree. Everything is read for exactly one institution; with no institution
there are no facts, never every bank's numbers together.

Free text a bank's systems sent (narrations, recipient names) is never read
here. It is untrusted input and could carry instructions aimed at the model,
so decisions are described by amount, channel, score and signal codes only.
"""
from __future__ import annotations

import re

from agents.copilot.baseline import MIN_TRANSACTIONS_FOR_BASELINE
from core.db import cursor, loads
from intelligence.context import (
    channel_breakdown,
    institution_summary,
    scam_pattern_breakdown,
    signal_frequency,
    signal_label,
)

RECENT_DECISIONS = 5
_SAFE_LABEL = re.compile(r"[^A-Za-z0-9 ./&()+\-]")


def _clean(value, limit: int = 40) -> str:
    """A label from the database, safe to put in a prompt or a chip."""
    return _SAFE_LABEL.sub("", str(value or ""))[:limit].strip()


def empty() -> dict:
    return {
        "summary": {"transactions_analyzed": 0, "blocked": 0, "flagged": 0, "passed": 0,
                    "avg_risk_score": 0.0, "fraud_prevented_ngn": 0},
        "patterns": [], "channels": [], "signals": [],
        "week": {"total": 0, "blocked": 0, "flagged": 0, "prev_total": 0, "prev_blocked": 0, "prev_flagged": 0},
        "queue": {"open": 0, "in_review": 0, "escalated": 0, "resolved": 0},
        "ghost": {"held": 0, "cancelled": 0, "released": 0, "held_amount": 0.0, "cancelled_amount": 0.0},
        "policy": {},
        "customers": {"total": 0, "real": 0, "test": 0, "with_history": 0, "with_baseline": 0},
        "peak_hour": None,
        "largest_block": 0.0,
        "recent": [],
        "mode": "sandbox",
    }


def gather(institution_id: str | None) -> dict:
    """One institution's figures for the assistant."""
    facts = empty()
    if not institution_id:
        return facts
    inst = institution_id

    facts["summary"] = institution_summary(inst)
    facts["patterns"] = [
        {"name": _clean(p["name"]), "label": _clean(p["label"]), "count": p["count"]}
        for p in scam_pattern_breakdown(inst)[:6]
    ]
    facts["channels"] = [
        {**c, "label": _clean(c["label"], 24), "channel": _clean(c["channel"], 24)} for c in channel_breakdown(inst)[:6]
    ]
    facts["signals"] = [{"label": _clean(s["label"]), "count": s["count"]} for s in signal_frequency(inst)[:6]]

    with cursor() as cur:
        cur.execute(
            """SELECT
                 SUM(created_at >= datetime('now', '-7 days')) AS total,
                 SUM(created_at >= datetime('now', '-7 days') AND action_taken = 'BLOCK') AS blocked,
                 SUM(created_at >= datetime('now', '-7 days') AND action_taken = 'FLAG') AS flagged,
                 SUM(created_at < datetime('now', '-7 days') AND created_at >= datetime('now', '-14 days')) AS prev_total,
                 SUM(created_at < datetime('now', '-7 days') AND created_at >= datetime('now', '-14 days')
                     AND action_taken = 'BLOCK') AS prev_blocked,
                 SUM(created_at < datetime('now', '-7 days') AND created_at >= datetime('now', '-14 days')
                     AND action_taken = 'FLAG') AS prev_flagged
               FROM transactions WHERE institution_id = ?""",
            (inst,),
        )
        row = cur.fetchone()
        facts["week"] = {k: int(row[k] or 0) for k in facts["week"]}

        cur.execute(
            """SELECT COALESCE(review_state, 'open') AS state, COUNT(*) AS n FROM transactions
               WHERE institution_id = ? AND action_taken IN ('FLAG', 'BLOCK') GROUP BY state""",
            (inst,),
        )
        for r in cur.fetchall():
            if r["state"] in facts["queue"]:
                facts["queue"][r["state"]] = r["n"]

        cur.execute(
            """SELECT UPPER(status) AS status, COUNT(*) AS n, COALESCE(SUM(amount), 0) AS amt
               FROM ghost_containers WHERE institution_id = ? GROUP BY UPPER(status)""",
            (inst,),
        )
        for r in cur.fetchall():
            key = {"HELD": "held", "CANCELLED": "cancelled", "RELEASED": "released"}.get(r["status"])
            if key:
                facts["ghost"][key] = r["n"]
                if key in ("held", "cancelled"):
                    facts["ghost"][f"{key}_amount"] = float(r["amt"])

        cur.execute(
            """SELECT COUNT(*) AS total, SUM(kind = 'real') AS real, SUM(kind = 'test') AS test
               FROM customers WHERE institution_id = ?""",
            (inst,),
        )
        c = cur.fetchone()
        cur.execute(
            """SELECT COUNT(*) AS with_history, SUM(n >= ?) AS with_baseline FROM (
                 SELECT user_id, COUNT(*) AS n FROM customer_history WHERE institution_id = ? GROUP BY user_id)""",
            (MIN_TRANSACTIONS_FOR_BASELINE, inst),
        )
        h = cur.fetchone()
        facts["customers"] = {
            "total": c["total"] or 0, "real": c["real"] or 0, "test": c["test"] or 0,
            "with_history": h["with_history"] or 0, "with_baseline": h["with_baseline"] or 0,
        }

        cur.execute(
            """SELECT hour_of_day AS h, COUNT(*) AS n FROM transactions
               WHERE institution_id = ? AND action_taken IN ('FLAG', 'BLOCK') AND hour_of_day IS NOT NULL
               GROUP BY hour_of_day ORDER BY n DESC LIMIT 1""",
            (inst,),
        )
        peak = cur.fetchone()
        facts["peak_hour"] = {"hour": peak["h"], "count": peak["n"]} if peak else None

        cur.execute(
            "SELECT COALESCE(MAX(amount), 0) AS m FROM transactions WHERE institution_id = ? AND action_taken = 'BLOCK'",
            (inst,),
        )
        facts["largest_block"] = float(cur.fetchone()["m"])

        cur.execute(
            """SELECT id, amount, channel, risk_score, action_taken, shield_signals, created_at,
                      COALESCE(review_state, 'open') AS review_state
               FROM transactions WHERE institution_id = ? AND action_taken IN ('FLAG', 'BLOCK')
               ORDER BY created_at DESC LIMIT ?""",
            (inst, RECENT_DECISIONS),
        )
        facts["recent"] = [
            {
                "ref": _clean(r["id"], 12),
                "amount": float(r["amount"] or 0),
                "channel": _clean(r["channel"], 24),
                "score": round(float(r["risk_score"] or 0), 2),
                "action": r["action_taken"],
                "signals": _signal_names(loads(r["shield_signals"], []) or []),
                "at": r["created_at"],
                "review_state": r["review_state"],
            }
            for r in cur.fetchall()
        ]

        cur.execute("SELECT mode FROM institutions WHERE institution_id = ?", (inst,))
        m = cur.fetchone()
        facts["mode"] = (m["mode"] if m else None) or "sandbox"

    from services import policy

    p = policy.effective(inst)
    facts["policy"] = {k: p[k] for k in ("flag_threshold", "block_threshold", "hold_high_minutes",
                                         "hold_medium_minutes", "hold_low_minutes")}
    facts["policy"]["custom"] = bool(p.get("custom"))
    return facts


def _signal_names(signals: list) -> list[str]:
    """The distinct signal labels on one decision, in the order they fired."""
    out: list[str] = []
    for sig in signals:
        if not isinstance(sig, str):
            continue
        code = sig.split(":", 1)[0].strip()
        label = _clean(signal_label(code))
        if code == "scam_pattern":
            label = "Scam-script match"
        if label and label not in out:
            out.append(label)
    return out[:4]


def hour_label(hour: int) -> str:
    h = hour % 12 or 12
    return f"{h}{'am' if hour < 12 else 'pm'}"


def naira(value: float) -> str:
    return f"₦{value:,.0f}"


def change(current: int, previous: int) -> str:
    """'up 40%' / 'down 12%' / 'flat' / 'new this week'."""
    if not previous:
        return "new this week" if current else "none either week"
    pct = round((current - previous) / previous * 100)
    if pct == 0:
        return "flat"
    return f"{'up' if pct > 0 else 'down'} {abs(pct)}%"


def grounding(f: dict) -> str:
    """The brief the model answers from. Numbers only, no customer text."""
    s, w, q, g, c, p = f["summary"], f["week"], f["queue"], f["ghost"], f["customers"], f["policy"]
    if not s["transactions_analyzed"] and not c["total"]:
        return ("This institution has no customers or scored transfers yet. It is in "
                f"{f['mode']} mode. Suggest importing customers and history in Settings > Data.")
    lines = [
        f"Mode: {f['mode']}",
        f"Transfers scored (all time): {s['transactions_analyzed']} | blocked {s['blocked']} | flagged {s['flagged']} | passed {s['passed']}",
        f"Average risk score: {s['avg_risk_score']}",
        f"Fraud prevented (blocked, cancelled or still held): {naira(s['fraud_prevented_ngn'])}",
        f"Largest blocked transfer: {naira(f['largest_block'])}",
        f"Last 7 days: {w['total']} scored ({change(w['total'], w['prev_total'])} on the 7 days before), "
        f"{w['blocked']} blocked ({change(w['blocked'], w['prev_blocked'])}), {w['flagged']} flagged ({change(w['flagged'], w['prev_flagged'])})",
        f"Review queue: {q['open']} open, {q['in_review']} in review, {q['escalated']} escalated, {q['resolved']} resolved",
        f"Ghost holds: {g['held']} held now ({naira(g['held_amount'])}), {g['cancelled']} cancelled by customers "
        f"({naira(g['cancelled_amount'])}), {g['released']} released",
        f"Customers: {c['total']} ({c['real']} real, {c['test']} test); {c['with_history']} with any history, "
        f"{c['with_baseline']} with a baseline (needs {MIN_TRANSACTIONS_FOR_BASELINE}+ transfers)",
    ]
    if p:
        lines.append(
            f"Risk policy ({'customised' if p.get('custom') else 'Fable defaults'}): flag at {p['flag_threshold']}, "
            f"block at {p['block_threshold']}; Ghost holds {p['hold_high_minutes']}/{p['hold_medium_minutes']}/"
            f"{p['hold_low_minutes']} minutes for high/medium/low risk"
        )
    if f["patterns"]:
        lines.append("Scam patterns (hits): " + ", ".join(f"{x['label']} ({x['count']})" for x in f["patterns"]))
    if f["channels"]:
        lines.append("Channels: " + ", ".join(
            f"{x['label']} {x['total']} transfers, {int(x['risk_rate'] * 100)}% flagged or blocked" for x in f["channels"]))
    if f["signals"]:
        lines.append("Signals on risky transfers: " + ", ".join(f"{x['label']} ({x['count']})" for x in f["signals"]))
    if f["peak_hour"]:
        lines.append(f"Riskiest hour: {hour_label(f['peak_hour']['hour'])} ({f['peak_hour']['count']} flagged or blocked)")
    if f["recent"]:
        lines.append("Most recent risky decisions (newest first):")
        for r in f["recent"]:
            lines.append(
                f"- {r['action']} {naira(r['amount'])} via {r['channel'] or 'unknown'}, score {r['score']}, "
                f"signals: {', '.join(r['signals']) or 'none recorded'}, at {r['at']} UTC, review {r['review_state']}"
            )
    return "\n".join(lines)
