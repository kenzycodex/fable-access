"""Identity assurance — deciding which factor a decision must be bound to.

Shield answers "how risky is this?". This module answers the question that
makes containment actually hold: "who must prove they are here, and with
what?".

The distinction that matters is *where the factor lives*. A PIN prompt inside
a compromised session is theatre — an attacker holding the session holds the
prompt too. So the higher tiers demand a factor the attacker cannot have:

  device-bound  a passkey whose private key never leaves the phone's secure
                element, so possession of the session is not possession of
                the key
  out-of-band   a code delivered to the registered address, so possession of
                the device is not possession of the channel

The escalation rule is the point. Risk arising from *identity* signals — a
new device, a new city — implies the session itself may not belong to the
customer, so those cases jump to a factor the session cannot satisfy, rather
than asking for one more thing the attacker already has.
"""
from config import BLOCK_THRESHOLD, FLAG_THRESHOLD

# Ordered weakest to strongest; comparisons rely on the ordering.
LEVELS = ["none", "pin", "passkey", "passkey_and_otp", "identity_check"]

# Signals that suggest the person driving the session may not be the customer.
IDENTITY_SIGNALS = ("device_anomaly", "location_anomaly", "timezone_mismatch")

# Reaching this many identity signals means "prove you are you", not
# "confirm you meant it".
IDENTITY_SIGNAL_ESCALATION = 2


def level_rank(level: str) -> int:
    try:
        return LEVELS.index(level)
    except ValueError:
        return 0


def satisfies(provided: str | None, required: str) -> bool:
    """Is the factor the caller actually completed strong enough?"""
    return level_rank(provided or "none") >= level_rank(required)


def _identity_signal_count(signals: list[str]) -> int:
    return sum(1 for s in signals if any(s.startswith(code) for code in IDENTITY_SIGNALS))


def required_level(risk_score: float, signals: list[str] | None = None, action: str | None = None) -> str:
    """The factor a transfer must carry before money can move."""
    signals = signals or []
    identity_hits = _identity_signal_count(signals)

    if risk_score >= BLOCK_THRESHOLD or action == "BLOCK":
        # A block driven by identity signals is the mule/takeover shape: demand
        # a check the session cannot produce at all.
        if identity_hits >= IDENTITY_SIGNAL_ESCALATION:
            return "identity_check"
        return "passkey_and_otp"

    if risk_score >= FLAG_THRESHOLD or action == "FLAG":
        # Same reasoning one tier down: an unfamiliar device on a flagged
        # transfer should not be waved through with a PIN the attacker has.
        if identity_hits >= IDENTITY_SIGNAL_ESCALATION:
            return "passkey_and_otp"
        if identity_hits:
            return "passkey"
        return "pin"

    return "none"


def release_level(risk_score: float, signals: list[str] | None = None) -> str:
    """The factor required to release money out of a Ghost container.

    Always at least one tier above the transfer itself. Ghost exists because
    the transfer was already judged dangerous, so releasing it is the single
    most attacker-valuable action in the product — an attacker who has the
    session will find the release button, and re-asking for what they already
    used to get in defeats the whole containment.
    """
    base = required_level(risk_score, signals)
    if base == "none":
        base = "pin"
    idx = min(level_rank(base) + 1, len(LEVELS) - 1)
    return LEVELS[idx]


def describe(level: str) -> dict:
    """UI copy + capability hints for a required level."""
    return {
        "none": {
            "label": "No extra verification",
            "detail": "Cleared on your existing session.",
            "factors": [],
        },
        "pin": {
            "label": "Transaction PIN",
            "detail": "Re-enter your PIN to confirm this transfer.",
            "factors": ["pin"],
        },
        "passkey": {
            "label": "Device biometric",
            "detail": "Confirm with the fingerprint or face unlock on this device.",
            "factors": ["passkey"],
        },
        "passkey_and_otp": {
            "label": "Biometric + emailed code",
            "detail": "Confirm on this device, then enter the code sent to your registered email.",
            "factors": ["passkey", "otp"],
        },
        "identity_check": {
            "label": "Identity verification",
            "detail": "This transfer needs a liveness check against your registered ID before it can proceed.",
            "factors": ["identity_check"],
        },
    }.get(level, {"label": level, "detail": "", "factors": []})
