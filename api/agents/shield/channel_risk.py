"""Channel risk weights, grounded in NIBSS fraud-landscape reporting.

These were previously inverted relative to the published data. USSD carried the
heaviest penalty (0.25) on the reasoning that it has no device fingerprint and
anyone with a SIM can initiate — a real argument about attack surface, but not
one the incident data supports. Mobile carried the lightest (0.05) despite being
among the most exploited channels every year and growing fastest.

What NIBSS actually reports:

  2020   web 47%, mobile 36%, ATM 9%, POS 7%
  2023   mobile, web and POS the most exploited, in that order
  2025   e-commerce and internet banking most affected, then POS, mobile, web
         mobile fraud attempts up 330% year on year
  USSD does not appear among the top exploited channels in any year

The weight has to reflect fraud *rate*, not fraud share, so channel usage
matters: mobile is ~43% of transaction volume against ~36% of fraud, which is a
slightly below-average rate, while web carries a large share of fraud on a much
smaller share of volume. USSD is ~35% of volume with little reported fraud.

Hence: web highest, POS and mobile moderate, USSD low. This also removes a real
equity problem — USSD is how Nigeria's feature-phone population banks, and
penalising the rail hardest landed the most friction on the customers least
equipped to clear a step-up.

Every value is env-overridable (FABLE_CHANNEL_<NAME>) so an institution can
retune against its own labelled outcomes, which is the only thing that would
make these authoritative rather than reasoned.
"""
import os


def _w(channel: str, default: float) -> float:
    try:
        return float(os.getenv(f"FABLE_CHANNEL_{channel.upper()}", default))
    except ValueError:
        return default


CHANNEL_RISK_WEIGHTS = {
    # Highest fraud rate: a large share of fraud on a small share of volume.
    "internet": _w("internet", 0.22),
    "pos": _w("pos", 0.18),
    # Heavily exploited and growing fastest, but also the largest share of
    # legitimate volume, so the rate is close to average.
    "mobile_app": _w("mobile_app", 0.12),
    # Not among the top exploited channels in any NIBSS year, despite carrying
    # roughly a third of transaction volume.
    "ussd": _w("ussd", 0.12),
    "atm": _w("atm", 0.12),
    "qr": _w("qr", 0.10),
    "branch": _w("branch", 0.02),   # In-person, lowest risk
    "unknown": _w("unknown", 0.15),  # Conservative default
}


def get_channel_risk(channel: str) -> float:
    return CHANNEL_RISK_WEIGHTS.get(channel, CHANNEL_RISK_WEIGHTS["unknown"])
