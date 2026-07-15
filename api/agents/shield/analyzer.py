"""Fable Shield — core risk scoring pipeline.

Implements the six signal layers from the build brief: amount anomaly,
new recipient, time anomaly, channel risk, NIP response code, and
Nigerian scam pattern matching (English + Pidgin), plus a small
Isolation Forest anomaly boost drawn from the user's own history.
"""
from datetime import datetime

from config import BLOCK_THRESHOLD, FLAG_THRESHOLD
from agents.copilot.baseline import get_user_baseline, get_user_history_arrays
from agents.shield.channel_risk import get_channel_risk
from agents.shield.nip_codes import get_nip_risk_signal
from agents.shield.patterns import match_scam_pattern
from agents.shield.anomaly import score_anomaly
from agents.shield.explainer import generate_explanation

PCI_FIELDS = ("card_number", "cvv", "pin", "track_data")


def sanitize_transaction(transaction: dict) -> dict:
    """Strip PCI fields before any processing or logging touches them."""
    return {k: v for k, v in transaction.items() if k not in PCI_FIELDS}


def analyze_transaction(user_id: str, transaction: dict, device: dict, context: dict) -> dict:
    transaction = sanitize_transaction(transaction)
    baseline = get_user_baseline(user_id)

    signals: list[str] = []
    score = 0.0
    now_hour = datetime.utcnow().hour

    # Step 1: Amount anomaly (progressive)
    if baseline and transaction["amount"] > baseline["avg_amount"] * 3:
        mult = round(transaction["amount"] / max(baseline["avg_amount"], 1))
        signals.append(f"amount_anomaly: {mult}x above your baseline")
        score += 0.25 if mult >= 10 else 0.20 if mult >= 5 else 0.15

    # Step 2: New recipient
    known_recipients = baseline["known_recipients"] if baseline else set()
    if transaction["recipient_account"] not in known_recipients:
        signals.append("new_recipient: first transfer to this account")
        score += 0.20

    # Step 3: Time anomaly
    typical_hours = baseline["typical_hours"] if baseline else list(range(8, 22))
    if baseline and now_hour not in typical_hours:
        signals.append("time_anomaly: outside your typical active hours")
        score += 0.12

    # Step 4: Channel risk weight
    channel = transaction.get("channel", "mobile_app")
    channel_boost = get_channel_risk(channel)
    if channel_boost > 0.05:
        signals.append(f"channel_risk: {channel} (+{channel_boost})")
        score += channel_boost

    # Step 5: NIP response code
    nip_code = transaction.get("nip_response_code")
    if nip_code and nip_code in ("34", "63", "08", "57"):
        nip = get_nip_risk_signal(nip_code)
        signals.append(f"nip_{nip_code}: {nip['description']}")
        score += nip["shield_score_boost"]

    # Step 6: Nigerian scam pattern (English + Pidgin)
    pattern = match_scam_pattern(transaction.get("narration", ""))
    if pattern:
        signals.append(f"scam_pattern: {pattern['name']}")
        score += pattern["risk_weight"]

    # Step 7 (auxiliary): Isolation Forest anomaly boost from own history
    if baseline:
        history_amounts, history_hours = get_user_history_arrays(user_id)
        ml_boost = score_anomaly(history_amounts, history_hours, transaction["amount"], now_hour)
        if ml_boost > 0.02:
            signals.append(f"ml_anomaly: isolation forest deviation (+{ml_boost})")
            score += ml_boost

    score = min(round(score, 3), 1.0)

    # Critical override: NIP code 34 (NIBSS-flagged fraud) always BLOCK
    if nip_code == "34":
        score = max(score, 0.95)

    action = "BLOCK" if score >= BLOCK_THRESHOLD else "FLAG" if score >= FLAG_THRESHOLD else "PASS"
    risk_level = "HIGH" if score >= BLOCK_THRESHOLD else "MEDIUM" if score >= FLAG_THRESHOLD else "LOW"

    explanation = generate_explanation(signals, transaction["amount"], action)

    return {
        "risk_score": score,
        "risk_level": risk_level,
        "action": action,
        "signals": signals,
        "explanation": explanation,
    }


def analyze_transaction_safe(user_id: str, transaction: dict, device: dict, context: dict) -> dict:
    """Never fail open: if analysis throws, return a conservative FLAG."""
    try:
        return analyze_transaction(user_id, transaction, device, context)
    except Exception as exc:
        return {
            "risk_score": 0.55,
            "risk_level": "MEDIUM",
            "action": "FLAG",
            "signals": [f"system_error: {type(exc).__name__}"],
            "explanation": "We couldn't fully verify this transfer due to a system issue, so we're asking you to confirm before it proceeds. Your money is safe.",
        }
