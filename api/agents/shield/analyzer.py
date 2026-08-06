"""Fable Shield — core risk scoring pipeline.

Twelve signal layers: the original six from the build brief (amount anomaly,
new recipient, time anomaly, channel risk, NIP response code, scam pattern),
the Isolation Forest anomaly boost, and five new context layers driven by the
real SDK data (device anomaly, location anomaly, session freshness, behavioral
anomaly, timezone mismatch).

Narration scanning is deliberately de-prioritized (most users skip the field);
the behavioral/device/location layers carry the weight users can't opt out of.
"""
from datetime import datetime

from agents.copilot.baseline import (
    COLD_START_PREMIUM,
    get_population_baseline,
    get_user_baseline,
    get_user_history_arrays,
)
from agents.shield.channel_risk import get_channel_risk
from agents.shield.nip_codes import get_nip_risk_signal
from agents.shield.patterns import match_scam_pattern
from agents.shield.anomaly import score_anomaly
from agents.shield.explainer import explain_now
from agents.shield.weights import (
    WEIGHTS,
    amount_anomaly_boost,
    thresholds_for,
    VELOCITY_WINDOW_MINUTES,
    VELOCITY_FLAG_COUNT,
    VELOCITY_HIGH_COUNT,
)

PCI_FIELDS = ("card_number", "cvv", "pin", "track_data")

# Narration is the weakest layer — useful when present, but most users leave
# the field empty, so its pattern weights are halved (0.5 → ~0.25 max).
NARRATION_WEIGHT_SCALE = 0.5

# "Large" relative to the user's own normal (or an absolute floor with no
# baseline). Context signals only boost on large transfers so everyday small
# payments from a new laptop don't get flagged.
LARGE_ABSOLUTE_FLOOR = 100_000


def sanitize_transaction(transaction: dict) -> dict:
    """Strip PCI fields before any processing or logging touches them."""
    return {k: v for k, v in transaction.items() if k not in PCI_FIELDS}


def _recent_transfer_count(user_id: str, institution_id: str | None) -> int:
    """How many transfers this customer has made in the velocity window.

    Both sides of the comparison are parsed by SQLite rather than compared as
    strings. `created_at` is written from Python as an isoformat ("...T05:00:00")
    while datetime('now', ...) yields "... 05:00:00" — and because 'T' (84) sorts
    after ' ' (32), a raw string comparison matched *every row sharing the
    cutoff's date*, turning a 10-minute window into a whole day (and, across
    midnight, the previous day too). datetime() on both sides normalises the
    formats so the window is the window.

    Any failure returns 0 — a missing velocity signal must never take down a
    decision.
    """
    try:
        from db import cursor

        where = "user_id = ? AND datetime(created_at) >= datetime('now', ?)"
        params: list = [user_id, f"-{VELOCITY_WINDOW_MINUTES} minutes"]
        if institution_id:
            where += " AND institution_id = ?"
            params.append(institution_id)
        with cursor() as cur:
            cur.execute(f"SELECT COUNT(*) AS n FROM transactions WHERE {where}", params)
            return cur.fetchone()["n"]
    except Exception:
        return 0


def _amount_boost_from_sigma(sigma: float) -> float:
    """Amount-anomaly boost from standard deviations above the customer's mean.

    Tiers chosen so the ceiling matches the previous flat scale (0.40) and a
    genuinely extreme transfer still escalates hard, while ordinary variation
    inside a customer's own spread costs little or nothing. Under 2 sigma is
    normal behaviour for that person and scores zero, which is where most of
    the everyday false-positive friction was coming from.
    """
    for threshold, boost in ((8, 0.40), (5, 0.32), (3.5, 0.24), (2.5, 0.16), (2, 0.10)):
        if sigma >= threshold:
            return boost
    return 0.0


def _rail_nip_code(context: dict) -> str | None:
    """The NIP response code, only when it genuinely came from the rail.

    Shield scores *before* a transfer is submitted, so in the normal flow there
    is no NIP response yet and this returns None. It exists for two real cases:
    a retry after a prior attempt returned a code, and a server-side integration
    that has already spoken to NIBSS. Both set `nip_source` to "rail"; a browser
    cannot, because the field is populated by the integrating server, not the
    SDK. Anything else is ignored rather than trusted.
    """
    if (context or {}).get("nip_source") != "rail":
        return None
    code = context.get("nip_response_code")
    return str(code) if code else None


def _client_local_hour(context: dict) -> int | None:
    """Device-local hour from the SDK's client_timestamp (sent as local time
    with its UTC offset), or None when the SDK didn't send one."""
    ts = context.get("client_timestamp")
    if not ts:
        return None
    try:
        return datetime.fromisoformat(str(ts).replace("Z", "+00:00")).hour
    except ValueError:
        return None


def analyze_transaction(user_id: str, transaction: dict, device: dict, context: dict,
                        institution_id: str | None = None) -> dict:
    transaction = sanitize_transaction(transaction)
    device = device or {}
    context = context or {}

    baseline = get_user_baseline(user_id)

    # Cold start. A customer with too little history used to get *no* baseline,
    # which silently disabled six of the twelve layers — amount, time, ML,
    # device, location and timezone all need something to compare against. A
    # new account could therefore move almost any sum unchallenged, which is
    # exactly the shape of mule and takeover activity. Fall back to how this
    # institution's customers behave, and price the newness itself.
    cold_start = baseline is None
    if cold_start:
        baseline = get_population_baseline(institution_id)

    signals: list[str] = []
    score = 0.0
    amount = transaction["amount"]

    if cold_start:
        if baseline:
            signals.append(
                f"cold_start: no personal history yet — judged against this bank's norms (+{COLD_START_PREMIUM})"
            )
        else:
            signals.append(
                f"cold_start: no history for this customer or institution (+{COLD_START_PREMIUM})"
            )
        score += COLD_START_PREMIUM

    # Step 12 groundwork: judge time-of-day on the device's clock, not server UTC.
    client_hour = _client_local_hour(context)
    now_hour = client_hour if client_hour is not None else datetime.utcnow().hour

    is_large = amount >= LARGE_ABSOLUTE_FLOOR or (
        baseline is not None and amount > baseline["avg_amount"] * 3
    )

    # Step 1: Amount anomaly (progressive).
    #
    # The scale runs past 10x deliberately. A student whose transfers sit
    # around ₦5k suddenly sending ₦250k is 45x out — a far stronger signal
    # than someone at 8x — and capping the boost at 10x let those extreme
    # cases score *lower* than milder ones that also tripped a time anomaly.
    # Judged against how much this customer's transfers normally vary, not just
    # a flat multiple of their mean.
    #
    # A raw multiple punished consistency and rewarded nothing: a trader whose
    # transfers legitimately swing between ₦80k and ₦400k hit "5x above
    # baseline" constantly, while someone who sends the same ₦5k every week and
    # suddenly sends ₦20k barely registered. The second is the genuinely
    # surprising one. Standard deviations above the mean captures that; a raw
    # ratio cannot.
    #
    # The multiple is still what the customer is shown, because "9x larger than
    # usual" is comprehensible and "3.2 standard deviations" is not.
    if baseline and amount > baseline["avg_amount"] * 3:
        avg = max(baseline["avg_amount"], 1)
        mult = round(amount / avg)
        stdev = baseline.get("stdev_amount") or (avg * 0.5)
        sigma = (amount - avg) / max(stdev, avg * 0.15)
        # The *lower* of the two readings, so a transfer has to look unusual on
        # both measures before it costs much.
        #
        # Sigma alone over-reacts for a very consistent customer: someone who
        # sends almost exactly ₦5,500 every week hits 12 sigma at ₦30,000, which
        # is only 5x their normal and not a scam-shaped number. A raw multiple
        # alone under-reacts for an erratic one, as Tunde's routine ₦300k showed.
        # Taking the minimum gives the consistent customer the multiple's
        # moderation and the erratic customer sigma's tolerance.
        by_sigma = _amount_boost_from_sigma(sigma)
        by_multiple, _tier = amount_anomaly_boost(mult)
        boost = round(min(by_sigma, by_multiple), 3)
        if boost > 0:
            signals.append(
                f"amount_anomaly: {mult}x above your baseline, "
                f"{sigma:.1f} standard deviations out (+{boost})"
            )
            score += boost

    # Step 2: New recipient, scaled by what is actually at stake.
    #
    # A flat weight said a first ₦2,000 to a colleague was as suspicious as a
    # first ₦2,000,000 to a stranger. People pay new people constantly and
    # almost none of it is fraud; what makes a new payee interesting is the
    # amount going to them. Small transfers now barely register, which is where
    # most of the everyday friction was, and large ones score higher than the
    # flat weight ever did.
    known_recipients = baseline["known_recipients"] if baseline else set()
    if transaction["recipient_account"] not in known_recipients:
        base = WEIGHTS["new_recipient"]
        if baseline:
            ratio = amount / max(baseline["avg_amount"], 1)
            scale = 0.35 if ratio < 1 else 0.7 if ratio < 3 else 1.0 if ratio < 10 else 1.4
        else:
            scale = 1.0
        boost = round(base * scale, 3)
        signals.append(f"new_recipient: first transfer to this account (+{boost})")
        score += boost

    # Step 3: Time anomaly — device-local hour vs the user's typical hours
    typical_hours = baseline["typical_hours"] if baseline else list(range(8, 22))
    if baseline and now_hour not in typical_hours:
        source = "device time" if client_hour is not None else "server time"
        signals.append(f"time_anomaly: outside your typical active hours ({source})")
        score += WEIGHTS["time_anomaly"]

    # Step 4: Channel risk weight
    channel = transaction.get("channel", "mobile_app")
    channel_boost = get_channel_risk(channel)
    if channel_boost > 0.05:
        signals.append(f"channel_risk: {channel} (+{channel_boost})")
        score += channel_boost

    # Step 5: NIP response code — rail-sourced only.
    #
    # This layer carries the heaviest weight in the pipeline (code 34 forces a
    # BLOCK at 0.95), so it must never be settable by the party being scored.
    # It used to read straight from the request body, which meant a caller could
    # force a block by sending "34" or — far worse — disable the layer entirely
    # by omitting the field, which is the default. A code is now only honoured
    # when the integration marks it as observed on the rail.
    nip_code = _rail_nip_code(context)
    if nip_code and nip_code in ("34", "63", "08", "57"):
        nip = get_nip_risk_signal(nip_code)
        signals.append(f"nip_{nip_code}: {nip['description']}")
        score += nip["shield_score_boost"]

    # Step 6: Nigerian scam pattern (English + Pidgin) — de-prioritized
    pattern = match_scam_pattern(transaction.get("narration", ""))
    if pattern:
        boost = round(pattern["risk_weight"] * NARRATION_WEIGHT_SCALE, 3)
        signals.append(f"scam_pattern: {pattern['name']} (+{boost})")
        score += boost

    # Step 7 (auxiliary): Isolation Forest anomaly boost from own history
    if baseline:
        history_amounts, history_hours = get_user_history_arrays(user_id)
        ml_boost = score_anomaly(history_amounts, history_hours, amount, now_hour, cache_key=user_id)
        if ml_boost > 0.02:
            signals.append(f"ml_anomaly: isolation forest deviation (+{ml_boost})")
            score += ml_boost

    # Step 8: Device anomaly — unrecognized fingerprint (weight scales with amount)
    fingerprint = device.get("fingerprint_id")
    # A population baseline carries no known devices, so this layer only
    # applies once the customer has their own history to contradict.
    if baseline and not cold_start and fingerprint and baseline["known_devices"] and fingerprint not in baseline["known_devices"]:
        boost = WEIGHTS["device_anomaly_large"] if is_large else WEIGHTS["device_anomaly"]
        # A device Fable has seen repeatedly is not a stranger, even if no
        # transfer from it has settled yet. trust_score climbs with each sighting
        # and was previously maintained and never read, so a device seen fifty
        # times scored identically to one seen twice.
        trust = (baseline.get("device_trust") or {}).get(fingerprint, 0.0)
        if trust > 0.5:
            damped = round(boost * (1 - min(trust, 0.9)), 3)
            signals.append(
                f"device_anomaly: unrecognized device, but seen before (+{damped})"
            )
            score += damped
        else:
            signals.append(f"device_anomaly: unrecognized device (+{boost})")
            score += boost

    # Step 9: Location anomaly — not in any known city / outside home country
    city = context.get("city")
    country = context.get("country")
    known_cities = baseline.get("known_cities", set()) if baseline else set()
    home_country = baseline.get("home_country") if baseline else None
    if home_country and country and country != home_country:
        boost = WEIGHTS["location_country"]
        signals.append(f"location_anomaly: transacting from {city or 'unknown city'}, {country} — usually {home_country} (+{boost})")
        score += boost
    elif known_cities and city and city not in known_cities:
        boost = WEIGHTS["location_city_large"] if is_large else WEIGHTS["location_city"]
        signals.append(f"location_anomaly: new city {city} (+{boost})")
        score += boost

    # Step 10: Session freshness — login-to-transfer under 30s on a large amount
    session_seconds = context.get("session_duration_seconds")
    if session_seconds is not None and session_seconds < 30 and is_large:
        boost = WEIGHTS["session_freshness"]
        signals.append(f"session_freshness: transfer {session_seconds}s after login (+{boost})")
        score += boost

    # Step 11: Behavioral anomaly — pasted account + zero hesitation + large amount
    pasted = context.get("paste_detected")
    pasted_fields = set(context.get("pasted_fields") or [])
    submit_seconds = context.get("time_to_submit_seconds")
    behavioral_boost = 0.0
    behavioral_reasons = []
    if pasted and ("account_number" in pasted_fields or not pasted_fields):
        behavioral_boost += WEIGHTS["behavioral_paste"]
        behavioral_reasons.append("account number pasted")
    if submit_seconds is not None and submit_seconds < 10 and is_large:
        behavioral_boost += WEIGHTS["behavioral_fast"]
        behavioral_reasons.append(f"submitted in {submit_seconds}s")
    if behavioral_boost > 0 and is_large:
        behavioral_boost = round(behavioral_boost, 3)
        signals.append(f"behavioral_anomaly: {', '.join(behavioral_reasons)} (+{behavioral_boost})")
        score += behavioral_boost

    # Step 13: Failed identity checks. previous_failed_attempts has sat in the
    # schema unused; a customer who just failed biometrics three times before
    # reaching for a large transfer is the clearest signal in the whole
    # pipeline, so it is read from the recorded failures rather than trusted
    # from the client.
    try:
        from agents.shield.stepup import recent_failure_count
        failed = recent_failure_count(user_id)
    except Exception:
        failed = 0
    failed = max(failed, int(context.get("previous_failed_attempts") or 0))
    if failed >= 3:
        boost = WEIGHTS["failed_verification_high"] if is_large else WEIGHTS["failed_verification_large"]
        signals.append(f"failed_verification: {failed} failed identity checks recently (+{boost})")
        score += boost
    elif failed > 0 and is_large:
        boost = WEIGHTS["failed_verification"]
        signals.append(f"failed_verification: {failed} failed identity check(s) (+{boost})")
        score += boost

    # Step 12: Timezone mismatch — device timezone disagrees with the baseline
    device_tz = context.get("client_timezone") or device.get("timezone")
    typical_tz = baseline.get("typical_timezone") if baseline else None
    if typical_tz and device_tz and device_tz != typical_tz:
        boost = WEIGHTS["timezone_mismatch"]
        signals.append(f"timezone_mismatch: device in {device_tz}, usually {typical_tz} (+{boost})")
        score += boost

    # Step 14: Velocity — a burst of transfers in a short window is the classic
    # account-drain / mule shape. Counted from transfers already recorded, so
    # it uses data Fable has rather than a field it wishes it had.
    recent = _recent_transfer_count(user_id, institution_id)
    if recent >= VELOCITY_HIGH_COUNT:
        boost = WEIGHTS["velocity_high"]
        signals.append(f"velocity: {recent} transfers in {VELOCITY_WINDOW_MINUTES}m (+{boost})")
        score += boost
    elif recent >= VELOCITY_FLAG_COUNT:
        boost = WEIGHTS["velocity"]
        signals.append(f"velocity: {recent} transfers in {VELOCITY_WINDOW_MINUTES}m (+{boost})")
        score += boost

    # Tenure discount. Past the cold-start threshold the friction model was
    # completely flat: a customer with 3 clean transfers and one with 500 over
    # two years scored identically, so no amount of good history ever bought
    # anything. A long, clean, confirmed record is evidence, and it was the one
    # kind the engine ignored.
    #
    # Applied last, capped small, and never below zero. It softens ordinary
    # friction for established customers without being able to rescue a
    # genuinely anomalous transfer: at the maximum it is worth less than a
    # single new-recipient signal.
    if baseline and not cold_start:
        discount = baseline.get("tenure_discount") or 0.0
        if discount > 0 and score > 0:
            applied = min(discount, score)
            signals.append(
                f"tenure: {baseline.get('transaction_count', 0)} clean transfers on record (-{round(applied, 3)})"
            )
            score -= applied

    score = min(round(max(score, 0.0), 3), 1.0)

    # Critical override: NIP code 34 (NIBSS-flagged fraud) always BLOCK
    if nip_code == "34":
        score = max(score, 0.95)

    # Channel-specific cutoffs: the same score means more on a riskier rail, so
    # USSD/internet trip sooner than an in-person branch transfer. Falls back to
    # the default when the channel is unknown.
    th = thresholds_for(channel)
    action = "BLOCK" if score >= th["block"] else "FLAG" if score >= th["flag"] else "PASS"
    risk_level = "HIGH" if score >= th["block"] else "MEDIUM" if score >= th["flag"] else "LOW"

    # Cache or template only. Anything requiring a network round trip happens
    # after the verdict is returned — see routers/shield.py. The decision is
    # complete at this point and does not depend on the prose.
    explanation, explanation_source = explain_now(signals, amount, action)

    return {
        "risk_score": score,
        "risk_level": risk_level,
        "action": action,
        "signals": signals,
        "explanation": explanation,
        "explanation_source": explanation_source,
    }


def analyze_transaction_safe(user_id: str, transaction: dict, device: dict, context: dict,
                             institution_id: str | None = None) -> dict:
    """Never fail open: if analysis throws, return a conservative FLAG."""
    try:
        return analyze_transaction(user_id, transaction, device, context, institution_id)
    except Exception as exc:
        return {
            "risk_score": 0.55,
            "risk_level": "MEDIUM",
            "action": "FLAG",
            "signals": [f"system_error: {type(exc).__name__}"],
            "explanation": "We couldn't fully verify this transfer due to a system issue, so we're asking you to confirm before it proceeds. Your money is safe.",
            "explanation_source": "template",
        }
