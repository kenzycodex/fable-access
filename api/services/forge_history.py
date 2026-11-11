"""Sixty days of believable history for the bank sandbox's five customers.

Fed through the same import the console uses (services/imports.py), so each
customer starts with real habits: who they pay, how much, at what hours. The
payees are the sandbox's own beneficiaries, so a saved recipient in the app is
an account the bank will accept. Deterministic: the same rows every time, with
dates counted back from today.
"""
import random
from datetime import datetime, timedelta, timezone

from services.forge_bridge import BENEFICIARIES, TEAM_ACCOUNTS

LAGOS = timezone(timedelta(hours=1))

# account -> (segment, usual payees, amount range, transfers in 60 days, usual hours)
HABITS = {
    "0123456789": ("Salaried", ["0987654321", "0123987001", "8031234506"], (2_000, 30_000), 34, [8, 12, 18, 19, 20, 21]),
    "0123456790": ("Trader", ["0123987002", "0123987004", "8051234507"], (50_000, 400_000), 46, [9, 10, 11, 13, 14, 15, 16]),
    "0123456791": ("Salaried", ["0987654322", "0123987003"], (5_000, 40_000), 24, [7, 12, 17, 19, 20]),
    "0123456792": ("Student", ["8031234506", "0987654321"], (1_000, 6_000), 30, [10, 13, 16, 20, 22, 23]),
    "0123456793": ("Trader", ["8051234507", "0123987001", "0123987002"], (100_000, 1_500_000), 40, [8, 9, 10, 11, 14, 15]),
}


def customer_rows() -> list[dict]:
    return [{"reference": account, "name": name, "segment": HABITS[account][0], "kind": "test",
             "opening_balance": balance} for account, (name, balance) in TEAM_ACCOUNTS.items()]


def transaction_rows(now: datetime | None = None) -> list[dict]:
    now = (now or datetime.now(timezone.utc)).astimezone(LAGOS)
    rows = []
    for account, (_segment, payees, (low, high), count, hours) in HABITS.items():
        rng = random.Random(f"fable-forge-{account}")
        for i in range(count):
            day = rng.randint(1, 60)
            when = (now - timedelta(days=day)).replace(hour=rng.choice(hours), minute=rng.randint(0, 59),
                                                      second=0, microsecond=0)
            payee = rng.choice(payees)
            name, bank = BENEFICIARIES[payee]
            amount = round(rng.uniform(low, high) / 100) * 100
            rows.append({
                "customer_reference": account, "reference": f"HIST-{account}-{i:03d}", "amount": amount,
                "occurred_at": when.isoformat(), "recipient_account": payee, "recipient_bank": bank,
                "recipient_name": name, "channel": "mobile_app", "outcome": "completed", "city": "Lagos",
                "country": "Nigeria",
            })
    return rows
