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

The values are engine parameters (core/engine_config.py, the "Channel risk"
group on the operator console's Engine page), changed with a backtest and a
second owner's approval like every other weight. FABLE_CHANNEL_<NAME> in the
server environment still wins over the console. Retuning against an
institution's own labelled outcomes is the only thing that would make these
authoritative rather than reasoned.
"""
from agents.shield.weights import channel_key, weights


def get_channel_risk(channel: str, p: dict | None = None) -> float:
    """The channel's weight in the parameters in force (or `p`)."""
    return weights(p)[channel_key(channel)]
