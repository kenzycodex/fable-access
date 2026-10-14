"""Test data, built the way a bank builds its own: customers and past transfers
go in through the import service, and only flagged or blocked decisions, which
a test needs in the review queue, are written directly.

Nothing here is used by the product. Fable has no demo data; these profiles
exist only so tests can assert on realistic behaviour (a trader's normal is a
student's anomaly).
"""
import random
import secrets
from datetime import timedelta

PROFILES = {
    "ada": {
        "name": "Ada Obi", "segment": "Salaried", "amount": (8_000, 55_000),
        "hours": [9, 10, 18, 19, 20, 21], "city": "Lagos", "per_day": 0.35, "balance": 847_320,
        "recipients": [("0123453456", "Access Bank"), ("0234564567", "GTBank"), ("0345675678", "Ikeja Electric")],
    },
    "tunde": {
        "name": "Tunde Bello", "segment": "Trader", "amount": (80_000, 400_000),
        "hours": [8, 9, 10, 11, 12, 13, 14, 15, 16], "city": "Lagos", "per_day": 0.55, "balance": 4_182_900,
        "recipients": [("0456786789", "Zenith Bank"), ("0567897890", "UBA"), ("0678908901", "First Bank")],
    },
    "chioma": {
        "name": "Chioma Nnamdi", "segment": "Student", "amount": (1_500, 9_000),
        "hours": [7, 11, 13, 15, 17, 19, 22, 23], "city": "Enugu", "per_day": 0.75, "balance": 63_450,
        "recipients": [("0789019012", "MTN"), ("0890120123", "Moniepoint MFB"), ("0901230134", "Kuda MFB")],
    },
}


def ref(institution_id: str, key: str) -> str:
    """The bank's reference for one of the test profiles."""
    return f"{institution_id}_{key}"


def uid(institution_id: str, key: str) -> str:
    """Fable's id for that customer."""
    from core import customers

    return customers.get(institution_id, ref(institution_id, key))["id"]


def add_customer(institution_id: str, key: str, *, kind: str = "test", balance: float | None = None) -> str:
    from core import customers
    from services import accounts as ledger

    profile = PROFILES[key]
    found = customers.get(institution_id, ref(institution_id, key))
    if found:
        return found["id"]
    made = customers.create(institution_id, ref(institution_id, key), kind=kind, source="console",
                            display_name=profile["name"], segment=profile["segment"])
    opening = profile["balance"] if balance is None else balance
    if kind == "test" and opening:
        ledger.ensure_account(made["id"], institution_id, opening_balance=opening)
    return made["id"]


def add_history(institution_id: str, key: str, days: int = 90, seed: int | None = None) -> int:
    """A profile's past transfers, imported. Deterministic for a given bank."""
    from core.utils import utcnow
    from services import imports

    profile = PROFILES[key]
    rnd = random.Random(seed if seed is not None else f"{institution_id}:{key}")
    now = utcnow()
    rows = []
    for i in range(days):
        if rnd.random() >= profile["per_day"]:
            continue
        day = now - timedelta(days=days - i)
        hour = rnd.choice(profile["hours"])
        account, bank = rnd.choice(profile["recipients"])
        rows.append({
            "customer_reference": ref(institution_id, key),
            "reference": f"{ref(institution_id, key)}-h{i}",
            "amount": round(rnd.uniform(*profile["amount"]), -2),
            "occurred_at": day.replace(hour=hour, minute=rnd.randint(0, 59)).isoformat() + "+01:00",
            "recipient_account": account,
            "recipient_bank": bank,
            "channel": "mobile_app",
            "device_id": f"fp_{key}",
            "city": profile["city"],
            "country": "Nigeria",
        })
    valid, errors = imports.validate("transactions", rows, sandbox=True)
    assert not errors, errors
    inserted, _, problems = imports.apply_rows(institution_id, "transactions", [d for _, d in valid], source="api")
    assert not problems, problems
    return inserted


def add_decisions(institution_id: str, key: str, count: int = 6, days: int = 60) -> int:
    """Flagged and blocked transfers, as Shield would have recorded them, so the
    review queue and fraud figures have something to show. Every other block
    was held by Ghost and cancelled by the customer."""
    from core.db import cursor, dumps
    from core.utils import utcnow

    user_id = uid(institution_id, key)
    rnd = random.Random(f"{institution_id}:{key}:decisions")
    with cursor() as cur:
        for i in range(count):
            action = "BLOCK" if i % 2 == 0 else "FLAG"
            when = utcnow() - timedelta(days=rnd.randint(1, days), hours=rnd.randint(0, 20))
            amount = round(rnd.uniform(150_000, 900_000), -3)
            txid = f"txn_{secrets.token_hex(6)}"
            cur.execute(
                """INSERT INTO transactions
                   (id, user_id, amount, currency, recipient_id, recipient_account, recipient_bank, narration,
                    channel, hour_of_day, risk_score, risk_level, action_taken, shield_signals,
                    confirmed_legitimate, is_seed, created_at, institution_id, review_state)
                   VALUES (?, ?, ?, 'NGN', 'unknown', ?, 'Unknown Bank', 'urgent help', 'mobile_app', ?, ?, ?, ?, ?,
                           0, 0, ?, ?, 'open')""",
                (txid, user_id, amount, f"09{rnd.randint(10_000_000, 99_999_999)}", when.hour,
                 0.9 if action == "BLOCK" else 0.6, "HIGH" if action == "BLOCK" else "MEDIUM", action,
                 dumps(["new_recipient: first transfer to this account", "scam_pattern: urgency"]),
                 when.isoformat(), institution_id),
            )
            if action == "BLOCK":
                cur.execute(
                    """INSERT INTO ghost_containers
                       (ghost_id, user_id, amount, recipient_account, cooling_window_minutes, risk_score,
                        explanation, status, created_at, expires_at, institution_id, signals)
                       VALUES (?, ?, ?, ?, 15, 0.9, 'Held for review.', 'CANCELLED', ?, ?, ?, '[]')""",
                    (f"ghost_{secrets.token_hex(6)}", user_id, amount, f"09{rnd.randint(10_000_000, 99_999_999)}",
                     when.isoformat(), (when + timedelta(minutes=15)).isoformat(), institution_id),
                )
    return count


def seed_bank(institution_id: str, name: str | None = None, keys=("tunde", "chioma"), days: int = 90) -> dict:
    """A sandbox bank with test customers, their history and some decisions."""
    from core.tenancy import register_institution

    register_institution(institution_id, name or institution_id.replace("_", " ").title(), f"risk@{institution_id}.ng")
    ids = {}
    for key in keys:
        ids[key] = add_customer(institution_id, key)
        add_history(institution_id, key, days=days)
        add_decisions(institution_id, key)
    return ids
