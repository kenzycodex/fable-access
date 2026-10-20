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
from agents.shield.weights import default_thresholds

# Ordered weakest to strongest; comparisons rely on the ordering.
LEVELS = ["none", "pin", "passkey", "passkey_and_otp", "identity_check"]

# Signals that suggest the person driving the session may not be the customer.
IDENTITY_SIGNALS = ("device_anomaly", "location_anomaly", "timezone_mismatch")

# Reaching this many identity signals means "prove you are you", not
# "confirm you meant it".
IDENTITY_SIGNAL_ESCALATION = 2


# The factors a customer can prove, and whether each exists today. A new one
# (a provider's face match, say) is added here and to level_for_factors; the
# tokens, the composed check and the release rules carry any factor name.
FACTORS = {
    "pin": {"label": "Transaction PIN", "status": "live"},
    "passkey": {"label": "Device unlock (passkey)", "status": "live"},
    # A one-time code by email, or by SMS where a provider is configured. The
    # channel does not change its weight; an SMS code alone never reaches the
    # top tier, because the top tier also needs a passkey and a PIN.
    "otp": {"label": "One-time code (email or SMS)", "status": "live"},
    # Planned: a liveness or face-match check through a KYC provider (Smile ID,
    # Youverify, Dojah, Prembly). Not built. Nothing can produce this factor
    # today, so no level can be reached with it.
    "liveness": {"label": "Face and liveness check", "status": "planned"},
}


def factor_available(name: str) -> bool:
    return FACTORS.get(name, {}).get("status") == "live"


# A one-time code on its own is one factor, the same weight as a PIN. It is
# named for what it is rather than recorded as "pin", so a token always says
# which factor was actually proved.
EQUIVALENT = {"otp": "pin"}


def level_rank(level: str) -> int:
    try:
        return LEVELS.index(EQUIVALENT.get(level, level))
    except ValueError:
        return 0


def level_for_factors(factors: set[str] | list[str], has_passkey: bool) -> str:
    """The tier a set of independently verified factors earns.

    Each tier needs exactly the factors it names:

      passkey + code + PIN  identity_check (the composed substitute for a
                            vendor liveness check, which Fable does not have)
      passkey + code        passkey_and_otp
      PIN + code            passkey_and_otp only for a customer with no
                            passkey: two independent factors, one of them out
                            of band, so a customer whose phone cannot hold a
                            passkey is not stranded. With a passkey enrolled
                            the device factor is required.
      passkey (+ PIN)       passkey
      PIN or code alone     pin
    """
    have = {f for f in factors if factor_available(f)}
    if {"passkey", "otp", "pin"} <= have:
        return "identity_check"
    # When a liveness provider exists: a face match plus a device factor will
    # reach the top tier as well. "liveness" is never available yet, so this
    # line cannot fire.
    if {"liveness", "passkey"} <= have:
        return "identity_check"
    if {"passkey", "otp"} <= have:
        return "passkey_and_otp"
    if {"pin", "otp"} <= have and not has_passkey:
        return "passkey_and_otp"
    if "passkey" in have:
        return "passkey"
    if "pin" in have:
        return "pin"
    if "otp" in have:
        return "otp"
    return "none"


def satisfies(provided: str | None, required: str) -> bool:
    """Is the factor the caller actually completed strong enough?"""
    return level_rank(provided or "none") >= level_rank(required)


def _identity_signal_count(signals: list[str]) -> int:
    return sum(1 for s in signals if any(s.startswith(code) for code in IDENTITY_SIGNALS))


def required_level(risk_score: float, signals: list[str] | None = None, action: str | None = None,
                   always_ask: bool = False) -> str:
    """The factor a transfer must carry before money can move.

    `always_ask` is the customer's own "always ask for a code" preference. It
    was stored, displayed on the security screen, and consulted by nothing, so
    a control the customer believed they had enabled did nothing at all. It can
    only ever *raise* the requirement: a customer asking for more friction gets
    it, and one who has not asked is unaffected.
    """
    signals = signals or []
    identity_hits = _identity_signal_count(signals)
    # The default cutoffs of the engine version in force, not import-time
    # constants, so a promoted version moves the step-up tiers with it.
    th = default_thresholds()

    if risk_score >= th["block"] or action == "BLOCK":
        # A block driven by identity signals is the mule/takeover shape: demand
        # a check the session cannot produce at all.
        if identity_hits >= IDENTITY_SIGNAL_ESCALATION:
            return "identity_check"
        return "passkey_and_otp"

    if risk_score >= th["flag"] or action == "FLAG":
        if always_ask:
            # They asked to always be challenged, so never fall to bare "pin"
            # on an identity-free flag.
            return "passkey" if not identity_hits else "passkey_and_otp"
        # Same reasoning one tier down: an unfamiliar device on a flagged
        # transfer should not be waved through with a PIN the attacker has.
        if identity_hits >= IDENTITY_SIGNAL_ESCALATION:
            return "passkey_and_otp"
        if identity_hits:
            return "passkey"
        return "pin"

    # A cleared transfer normally passes with no friction at all. A customer who
    # explicitly opted into always being asked gets a PIN prompt instead.
    return "pin" if always_ask else "none"


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
            # Fable has no liveness or ID-document check. This tier is every
            # factor the customer has, verified together, and says so.
            "label": "Full verification",
            "detail": ("Confirm on this device, enter your PIN, then enter the one-time code we send you. "
                       "This combines the security you already set up. It is not a face or ID check."),
            "factors": ["passkey", "pin", "otp"],
        },
    }.get(level, {"label": level, "detail": "", "factors": []})
