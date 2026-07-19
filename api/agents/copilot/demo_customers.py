"""Per-institution demo customers.

Every institution gets the same three archetypes, namespaced by tenant
(`{institution_id}_{key}`), each with a deliberately different spending
baseline. That difference is the point: the identical ₦250,000 transfer is
routine for Tunde the trader, a 5x anomaly for Ada, and wildly out of
character for Chioma — which is what makes Copilot's per-customer baselines
visible instead of theoretical.
"""
import random
import uuid
from datetime import datetime, timedelta

from db import cursor

DEMO_CUSTOMERS = [
    {
        "key": "ada",
        "name": "Ada Obi",
        "persona": "Salaried professional",
        "description": "Steady mid-size transfers to a small circle, mostly evenings.",
        "amount_range": (8_000, 55_000),
        "hours": [9, 10, 18, 19, 20, 21],
        "city": "Lagos",
        "recipients": [
            {"recipient_id": "mum", "recipient_account": "0123453456", "recipient_bank": "Access Bank", "narration": "food money"},
            {"recipient_id": "landlord", "recipient_account": "0234564567", "recipient_bank": "GTBank", "narration": "rent contribution"},
            {"recipient_id": "nepa", "recipient_account": "0345675678", "recipient_bank": "Ikeja Electric", "narration": "light bill"},
        ],
        "per_day_chance": 0.35,
    },
    {
        "key": "tunde",
        "name": "Tunde Bello",
        "persona": "Trader / business owner",
        "description": "Large supplier payments during business hours. Big numbers are normal here.",
        "amount_range": (80_000, 400_000),
        "hours": [8, 9, 10, 11, 12, 13, 14, 15, 16],
        "city": "Lagos",
        "recipients": [
            {"recipient_id": "alaba_supplier", "recipient_account": "0456786789", "recipient_bank": "Zenith Bank", "narration": "stock payment"},
            {"recipient_id": "logistics", "recipient_account": "0567897890", "recipient_bank": "UBA", "narration": "haulage"},
            {"recipient_id": "shop_rent", "recipient_account": "0678908901", "recipient_bank": "First Bank", "narration": "shop rent"},
        ],
        "per_day_chance": 0.55,
    },
    {
        "key": "chioma",
        "name": "Chioma Nnamdi",
        "persona": "Student",
        "description": "Frequent small transfers at all hours. A five-figure transfer is already unusual.",
        "amount_range": (1_500, 9_000),
        "hours": [7, 11, 13, 15, 17, 19, 22, 23],
        "city": "Enugu",
        "recipients": [
            {"recipient_id": "airtime", "recipient_account": "0789019012", "recipient_bank": "MTN", "narration": "airtime"},
            {"recipient_id": "food_vendor", "recipient_account": "0890120123", "recipient_bank": "Moniepoint MFB", "narration": "food"},
            {"recipient_id": "roommate", "recipient_account": "0901230134", "recipient_bank": "Kuda MFB", "narration": "share"},
        ],
        "per_day_chance": 0.75,
    },
]


def user_id_for(institution_id: str, key: str) -> str:
    return f"{institution_id}_{key}"


def customers_for_institution(institution_id: str) -> list[dict]:
    """The roster the demo bank renders in its customer picker."""
    return [
        {
            "user_id": user_id_for(institution_id, c["key"]),
            "key": c["key"],
            "name": c["name"],
            "persona": c["persona"],
            "description": c["description"],
            "typical_range": f"₦{c['amount_range'][0]:,} – ₦{c['amount_range'][1]:,}",
            "city": c["city"],
        }
        for c in DEMO_CUSTOMERS
    ]


def _insert_seed_transaction(user_id: str, institution_id: str, customer: dict, recipient: dict, day: datetime) -> None:
    amount = round(random.uniform(*customer["amount_range"]), -2)
    hour = random.choice(customer["hours"])
    ts = day.replace(hour=hour, minute=random.randint(0, 59))

    with cursor() as cur:
        cur.execute(
            """INSERT INTO transactions
               (id, user_id, amount, currency, recipient_id, recipient_account, recipient_bank,
                narration, channel, device_fingerprint, hour_of_day, risk_score, risk_level,
                action_taken, shield_signals, confirmed_legitimate, is_seed, created_at,
                city, country, location_source, institution_id)
               VALUES (?, ?, ?, 'NGN', ?, ?, ?, ?, 'mobile_app', ?, ?, 0.03, 'LOW', 'PASS', '[]', 1, 1, ?,
                       ?, 'Nigeria', 'seed', ?)""",
            (
                f"txn_{uuid.uuid4().hex[:12]}",
                user_id,
                amount,
                recipient["recipient_id"],
                recipient["recipient_account"],
                recipient["recipient_bank"],
                recipient["narration"],
                f"fp_seed_{customer['key']}",
                hour,
                ts.isoformat(),
                customer["city"],
                institution_id,
            ),
        )


def seed_customer(institution_id: str, customer: dict, days: int) -> int:
    """Build one customer's history. Returns the number of transactions made."""
    user_id = user_id_for(institution_id, customer["key"])
    now = datetime.utcnow()
    count = 0

    with cursor() as cur:
        cur.execute("DELETE FROM transactions WHERE user_id = ?", (user_id,))
        cur.execute("DELETE FROM ghost_containers WHERE user_id = ?", (user_id,))
        cur.execute(
            "INSERT OR IGNORE INTO fable_users (user_id, institution_id) VALUES (?, ?)",
            (user_id, institution_id),
        )

    for i in range(days):
        day = now - timedelta(days=days - i)
        if random.random() < customer["per_day_chance"]:
            recipient = random.choice(customer["recipients"])
            _insert_seed_transaction(user_id, institution_id, customer, recipient, day)
            count += 1

    return count


def seed_institution(institution_id: str, days: int = 90) -> dict:
    """Seed every demo customer for a tenant, plus its historical threat feed."""
    from routers.demo import seed_threat_history

    per_customer = {}
    for customer in DEMO_CUSTOMERS:
        per_customer[customer["name"]] = seed_customer(institution_id, customer, days)

    # Threats land on Ada so the institution feed has blocked/flagged history.
    threats = seed_threat_history(user_id_for(institution_id, "ada"), days, institution_id)

    return {
        "institution_id": institution_id,
        "customers": per_customer,
        "transactions_created": sum(per_customer.values()),
        "threats_created": threats,
    }
