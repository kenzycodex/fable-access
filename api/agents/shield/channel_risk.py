"""Channel risk weights based on NIBSS 2023-2025 fraud incident data."""

CHANNEL_RISK_WEIGHTS = {
    "mobile_app": 0.05,   # Lowest — Copilot personalizes per user
    "ussd": 0.25,         # Highest — no device fingerprint, anyone with SIM can initiate
    "pos": 0.20,          # 26.37% of all Nigerian fraud incidents 2023
    "internet": 0.18,     # Highest loss concentration 2025
    "atm": 0.12,          # Card cloning risk
    "qr": 0.10,           # Emerging spoofing risk
    "branch": 0.02,       # In-person, lowest risk
    "unknown": 0.15,      # Conservative default
}


def get_channel_risk(channel: str) -> float:
    return CHANNEL_RISK_WEIGHTS.get(channel, CHANNEL_RISK_WEIGHTS["unknown"])
