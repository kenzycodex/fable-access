"""Per-institution demo customers.

Every institution gets the same three archetypes, namespaced by tenant
(`{institution_id}_{key}`), each with a deliberately different spending
baseline. That difference is the point: the identical ₦250,000 transfer is
routine for Tunde the trader, a 5x anomaly for Ada, and wildly out of
character for Chioma — which is what makes Copilot's per-customer baselines
visible instead of theoretical.
"""
import hashlib
import os
import random
import uuid
from datetime import datetime, timedelta

from db import cursor

# Each institution gets its own people. Sharing one cast across tenants made
# every bank look like the same bank: identical names, identical balances, and
# — because the demo feed keys on customer name — identical transactions
# bleeding between institutions.
NAME_POOLS = {
    "ada": [
        ("Ada Obi", 847_320), ("Ngozi Eze", 612_400), ("Folake Adeyemi", 933_150),
        ("Amara Nwosu", 704_880), ("Zainab Bello", 588_600), ("Ifeoma Duru", 1_002_450),
    ],
    "tunde": [
        ("Tunde Bello", 4_182_900), ("Emeka Okafor", 3_640_500), ("Musa Danjuma", 5_218_700),
        ("Segun Alabi", 2_970_300), ("Chukwuma Eze", 4_806_100), ("Yakubu Sani", 3_155_900),
    ],
    "chioma": [
        ("Chioma Nnamdi", 63_450), ("Blessing Umeh", 41_200), ("Tobi Alade", 78_900),
        ("Halima Yusuf", 52_700), ("Kelechi Obi", 35_800), ("Temi Ogunlade", 69_300),
    ],
}


def _tenant_pick(institution_id: str, key: str) -> tuple[str, int]:
    """Deterministic per-tenant identity: the same bank always gets the same
    people, different banks get different ones."""
    pool = NAME_POOLS[key]
    digest = hashlib.sha256(f"{institution_id}:{key}".encode()).hexdigest()
    return pool[int(digest[:8], 16) % len(pool)]

DEMO_CUSTOMERS = [
    {
        "key": "ada",
        "name": "Ada Obi",
        "persona": "Salaried professional",
        "description": "Mid-size transfers, mostly evenings.",
        "amount_range": (8_000, 55_000),
        "opening_balance": 847_320,
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
        "description": "Large supplier payments. Big numbers are normal.",
        "amount_range": (80_000, 400_000),
        "opening_balance": 4_182_900,
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
        "description": "Frequent small transfers. Five figures is unusual.",
        "amount_range": (1_500, 9_000),
        "opening_balance": 63_450,
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


# How many archetypes a newly provisioned institution gets, and in what order
# they are dropped when fewer are wanted.
#
# The ordering is deliberate: the demo's strongest single moment is the same
# ₦250,000 clearing for the trader and stopping the student, whose baselines sit
# roughly 50x apart. Ada sits between them and blunts that contrast, so she is
# the first to go when the roster shrinks.
ROSTER_PRIORITY = ["tunde", "chioma", "ada"]
DEFAULT_ROSTER_SIZE = int(os.getenv("FABLE_DEMO_CUSTOMERS", "2"))


def roster_for(size: int | None = None) -> list[dict]:
    """The archetypes to seed, most contrasting first."""
    n = max(1, min(size or DEFAULT_ROSTER_SIZE, len(DEMO_CUSTOMERS)))
    by_key = {c["key"]: c for c in DEMO_CUSTOMERS}
    return [by_key[k] for k in ROSTER_PRIORITY[:n] if k in by_key]


def user_id_for(institution_id: str, key: str) -> str:
    return f"{institution_id}_{key}"


def customer_identity(institution_id: str, key: str) -> tuple[str, int]:
    """Name and opening balance for one archetype at one institution."""
    return _tenant_pick(institution_id, key)


def customers_for_institution(institution_id: str) -> list[dict]:
    """The roster the demo bank renders in its customer picker."""
    out = []
    for c in roster_for():
        name, balance = customer_identity(institution_id, c["key"])
        out.append({
            "user_id": user_id_for(institution_id, c["key"]),
            "key": c["key"],
            "name": name,
            "persona": c["persona"],
            "description": c["description"],
            "typical_range": f"₦{c['amount_range'][0]:,} – ₦{c['amount_range'][1]:,}",
            "opening_balance": balance,
            "city": c["city"],
        })
    return out


def _insert_seed_transaction(user_id: str, institution_id: str, customer: dict, recipient: dict,
                             day: datetime, rng: random.Random | None = None) -> None:
    rnd = rng or random
    amount = round(rnd.uniform(*customer["amount_range"]), -2)
    hour = rnd.choice(customer["hours"])
    ts = day.replace(hour=hour, minute=rnd.randint(0, 59))

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


def seed_customer(institution_id: str, customer: dict, days: int,
                  rng: random.Random | None = None) -> int:
    """Build one customer's history. Returns the number of transactions made."""
    rnd = rng or random
    user_id = user_id_for(institution_id, customer["key"])
    _, opening_balance = customer_identity(institution_id, customer["key"])
    now = datetime.utcnow()
    count = 0

    with cursor() as cur:
        # Scoped to seed rows. Unscoped, re-provisioning an institution deleted
        # its customers' real transfers as well as the synthetic ones, and
        # provisioning is reachable by name collision.
        cur.execute("DELETE FROM transactions WHERE user_id = ? AND is_seed = 1", (user_id,))
        cur.execute(
            "DELETE FROM ghost_containers WHERE user_id = ? AND explanation LIKE 'Seeded%'",
            (user_id,),
        )
        cur.execute(
            "INSERT OR IGNORE INTO fable_users (user_id, institution_id) VALUES (?, ?)",
            (user_id, institution_id),
        )

    # Give the archetype the opening balance its persona implies. ensure_account
    # was only ever called with the default of 0.0, so every seeded customer
    # started empty while the picker advertised a balance they did not have,
    # and a customer with 90 days of ₦400k history could not send ₦1,000.
    from accounts import ensure_account
    ensure_account(user_id, institution_id, opening_balance=opening_balance)

    for i in range(days):
        day = now - timedelta(days=days - i)
        if rnd.random() < customer["per_day_chance"]:
            recipient = rnd.choice(customer["recipients"])
            _insert_seed_transaction(user_id, institution_id, customer, recipient, day, rnd)
            count += 1

    return count


def seed_institution(institution_id: str, days: int = 90, customers: int | None = None) -> dict:
    """Seed a tenant's demo customers, plus historical threat activity."""
    from routers.demo import seed_threat_history

    # Deterministic per institution. Bare random() meant re-seeding the same
    # bank produced different history and therefore different baselines, so two
    # runs were not comparable — while _tenant_pick right above was carefully
    # deterministic. Same input, same demo.
    rnd = random.Random(hashlib.sha256(institution_id.encode()).hexdigest())

    roster = roster_for(customers)
    per_customer: dict[str, int] = {}
    for customer in roster:
        # Key on the tenant's actual name, not the archetype's placeholder.
        # Reporting "Ada Obi" for a bank whose picker shows "Ngozi Eze" made the
        # provisioning response contradict the product.
        name, _ = customer_identity(institution_id, customer["key"])
        per_customer[name] = seed_customer(institution_id, customer, days, rnd)

    # Threats used to land entirely on one archetype, so every alert in the
    # console belonged to the same person and the other customers had a
    # spotless history. Spread across the roster, weighted by persona: the
    # student sees more small-value scams, the trader more supplier fraud.
    threats = 0
    share = max(1, 22 // len(roster))
    for customer in roster:
        threats += seed_threat_history(
            user_id_for(institution_id, customer["key"]), days, institution_id,
            count=share, rng=rnd,
        )

    return {
        "institution_id": institution_id,
        "customers": per_customer,
        "transactions_created": sum(per_customer.values()),
        "threats_created": threats,
    }
