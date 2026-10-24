"""NIBSS Instant Payment (NIP) response code interpreter.

Codes drawn from NIP ISO-8583-derived response code conventions. Code 34
("Suspected Fraud") is a NIBSS-flagged signal and always forces a BLOCK,
regardless of the computed score — the rail itself is telling us this
account is dirty.
"""

NIP_RESPONSE_CODES = {
    "00": {"description": "Approved", "shield_score_boost": 0.0},
    "08": {"description": "Honour with identification — additional verification requested", "shield_score_boost": 0.10},
    "34": {"description": "Suspected fraud — NIBSS-flagged account", "shield_score_boost": 0.60},
    "51": {"description": "Insufficient funds", "shield_score_boost": 0.0},
    "57": {"description": "Transaction not permitted to cardholder/account", "shield_score_boost": 0.15},
    "63": {"description": "Security violation — velocity or rule breach detected upstream", "shield_score_boost": 0.35},
    "91": {"description": "Issuer or switch inoperative", "shield_score_boost": 0.0},
}


def get_nip_risk_signal(code: str) -> dict:
    return NIP_RESPONSE_CODES.get(code, {"description": f"Unrecognized response code {code}", "shield_score_boost": 0.05})
