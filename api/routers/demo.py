"""Demo seed endpoint — generates 90 days of synthetic Nigerian transaction
history for a demo user so Copilot's baseline is rich enough to make
personalization visible live during a demo."""
import json
import random
import uuid
from datetime import datetime, timedelta
from typing import Optional

from fastapi import APIRouter, Query

from db import DEFAULT_INSTITUTION_ID, cursor, loads, row_to_dict
from models.schemas import DemoSeedRequest, InstitutionSeedRequest

router = APIRouter(prefix="/v1/demo", tags=["demo"])


@router.get("/overview/{user_id}")
def customer_overview(user_id: str, institution: Optional[str] = Query(None), limit: int = Query(60, ge=1, le=200)):
    """One round-trip for a customer's home screen: balance, recent transfers
    and the learned baseline together.

    The demo bank used to fire three separate requests (account, transactions,
    transparency) on every customer switch and poll. Composing them here means
    switching customers, or refreshing, is a single call instead of three across
    a cross-region hop."""
    import accounts as ledger
    from agents.copilot.transparency import get_transparency_data

    where = "WHERE user_id = ?"
    params: list = [user_id]
    if institution:
        where += " AND institution_id = ?"
        params.append(institution)

    with cursor() as cur:
        cur.execute(
            f"""SELECT id, user_id, amount, recipient_id, recipient_name, recipient_account,
                       recipient_bank, narration, channel, device_fingerprint, risk_score,
                       risk_level, action_taken, shield_signals, latency_ms, created_at,
                       status, explanation
                FROM transactions {where}
                ORDER BY created_at DESC LIMIT ?""",
            params + [limit],
        )
        rows = [row_to_dict(r) for r in cur.fetchall()]
    for r in rows:
        r["signals"] = loads(r.pop("shield_signals"), [])

    return {
        "user_id": user_id,
        "balance": {**ledger.get_balance(user_id, institution), "limits": ledger.limits()},
        "transactions": rows,
        "baseline": get_transparency_data(user_id).get("what_we_know", {}),
    }

RECURRING_RECIPIENTS = [
    {"recipient_id": "mum", "recipient_account": "0123453456", "recipient_bank": "Access Bank", "amount_range": (8000, 12000), "narration": "food money", "day_of_month": 28},
    {"recipient_id": "landlord", "recipient_account": "0234564567", "recipient_bank": "GTBank", "amount_range": (45000, 55000), "narration": "rent contribution", "day_of_month": 5},
    {"recipient_id": "nepa", "recipient_account": "0345675678", "recipient_bank": "Ikeja Electric", "amount_range": (12000, 18000), "narration": "light bill", "day_of_month": 15},
]

CASUAL_RECIPIENTS = [
    {"recipient_id": "chioma", "recipient_account": "0456786789", "recipient_bank": "Zenith Bank", "amount_range": (3000, 15000), "narration": "thanks"},
    {"recipient_id": "mr_biggs", "recipient_account": "0567897890", "recipient_bank": "UBA", "amount_range": (2000, 6000), "narration": "food"},
    {"recipient_id": "tunde", "recipient_account": "0678908901", "recipient_bank": "Access Bank", "amount_range": (5000, 20000), "narration": "owe you"},
]


def _seed_transaction(user_id: str, recipient: dict, created_at: datetime):
    amount = round(random.uniform(*recipient["amount_range"]), -2)
    hour = random.choice([9, 10, 11, 13, 17, 18, 19, 20])
    ts = created_at.replace(hour=hour, minute=random.randint(0, 59))

    with cursor() as cur:
        cur.execute(
            """INSERT INTO transactions
               (id, user_id, amount, currency, recipient_id, recipient_account, recipient_bank,
                narration, channel, device_fingerprint, hour_of_day, risk_score, risk_level,
                action_taken, shield_signals, confirmed_legitimate, is_seed, created_at)
               VALUES (?, ?, ?, 'NGN', ?, ?, ?, ?, 'mobile_app', 'fp_seed_device_001', ?, 0.03, 'LOW', 'PASS', '[]', 1, 1, ?)""",
            (
                f"txn_{uuid.uuid4().hex[:12]}",
                user_id,
                amount,
                recipient["recipient_id"],
                recipient["recipient_account"],
                recipient["recipient_bank"],
                recipient["narration"],
                hour,
                ts.isoformat(),
            ),
        )


@router.post("/seed-institution")
def seed_institution_endpoint(payload: InstitutionSeedRequest):
    """Seed all demo customers for one tenant (used at provisioning time and
    by the demo bank when it opens onto an institution with no history)."""
    from agents.copilot.demo_customers import seed_institution

    return seed_institution(payload.institution_id, payload.days)


@router.post("/seed")
def seed(payload: DemoSeedRequest):
    user_id = payload.user_id
    days = payload.days

    with cursor() as cur:
        cur.execute("DELETE FROM transactions WHERE user_id = ?", (user_id,))
        cur.execute("DELETE FROM ghost_containers WHERE user_id = ?", (user_id,))
        cur.execute(
            "INSERT OR IGNORE INTO fable_users (user_id, institution_id) VALUES (?, 'demo_bank')",
            (user_id,),
        )

    now = datetime.utcnow()
    count = 0

    for i in range(days):
        day = now - timedelta(days=days - i)

        for recipient in RECURRING_RECIPIENTS:
            if day.day == recipient["day_of_month"]:
                _seed_transaction(user_id, recipient, day)
                count += 1

        # ~35% chance of a casual small transfer any given day
        if random.random() < 0.12:
            recipient = random.choice(CASUAL_RECIPIENTS)
            _seed_transaction(user_id, recipient, day)
            count += 1

    threats = seed_threat_history(user_id, days)

    return {
        "status": "seeded",
        "user_id": user_id,
        "days": days,
        "transactions_created": count,
        "threats_created": threats,
        "message": f"{count} legitimate + {threats} threat transactions seeded across {days} days for {user_id}.",
    }


# Historical fraud attempts (BLOCK/FLAG) so the institution dashboard's threat
# trend, risk distribution and fraud-prevented figures are populated on seed.
THREAT_TEMPLATES = [
    {"amount": (350000, 800000), "bank": "Zenith Bank", "narration": "urgent help abeg", "level": "HIGH", "action": "BLOCK",
     "signals": ["amount_anomaly: 28x above baseline", "new_recipient: first transfer to this account", "channel_risk: ussd (+0.25)", "scam_pattern: urgency_pidgin"], "channel": "ussd", "score": (0.88, 0.99), "ghost": True},
    {"amount": (200000, 500000), "bank": "OPay", "narration": "double your money forex", "level": "HIGH", "action": "BLOCK",
     "signals": ["amount_anomaly: 15x above baseline", "new_recipient: first transfer to this account", "scam_pattern: investment_fraud"], "channel": "internet", "score": (0.85, 0.96), "ghost": True},
    {"amount": (120000, 300000), "bank": "GTBank", "narration": "changed account new details", "level": "HIGH", "action": "BLOCK",
     "signals": ["new_recipient: first transfer to this account", "scam_pattern: supplier_fraud", "channel_risk: internet (+0.18)"], "channel": "internet", "score": (0.80, 0.92), "ghost": True},
    {"amount": (60000, 150000), "bank": "Access Bank", "narration": "verify your bvn now", "level": "MEDIUM", "action": "FLAG",
     "signals": ["new_recipient: first transfer to this account", "scam_pattern: account_blocked", "time_anomaly: outside typical hours"], "channel": "mobile_app", "score": (0.55, 0.72), "ghost": False},
    {"amount": (40000, 120000), "bank": "UBA", "narration": "emergency mama dey hospital", "level": "MEDIUM", "action": "FLAG",
     "signals": ["amount_anomaly: 6x above baseline", "scam_pattern: family_impersonation"], "channel": "mobile_app", "score": (0.52, 0.68), "ghost": False},
]


def seed_threat_history(user_id: str, days: int, institution_id: str = DEFAULT_INSTITUTION_ID) -> int:
    created = 0
    now = datetime.utcnow()
    # ~22 historical threats spread across the window
    for _ in range(22):
        tmpl = random.choice(THREAT_TEMPLATES)
        day_offset = random.randint(0, max(days - 1, 1))
        ts = (now - timedelta(days=day_offset)).replace(hour=random.choice([1, 2, 3, 22, 23, 13]), minute=random.randint(0, 59))
        amount = round(random.uniform(*tmpl["amount"]), -3)
        score = round(random.uniform(*tmpl["score"]), 3)
        txid = f"txn_{uuid.uuid4().hex[:12]}"
        acct = f"0{random.randint(100000000, 999999999)}"

        with cursor() as cur:
            cur.execute(
                """INSERT INTO transactions
                   (id, user_id, amount, currency, recipient_id, recipient_account, recipient_bank,
                    narration, channel, device_fingerprint, hour_of_day, risk_score, risk_level,
                    action_taken, shield_signals, confirmed_legitimate, is_seed, created_at,
                    institution_id)
                   VALUES (?, ?, ?, 'NGN', 'unknown', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 1, ?, ?)""",
                (
                    txid, user_id, amount, acct, tmpl["bank"], tmpl["narration"], tmpl["channel"],
                    f"fp_threat_{random.randint(1000,9999)}", ts.hour, score, tmpl["level"],
                    tmpl["action"], json.dumps(tmpl["signals"]), ts.isoformat(),
                    institution_id,
                ),
            )
            # Blocked high-risk transfers where the user reached for Ghost and
            # cancelled = fraud prevented (money returned).
            if tmpl["ghost"] and random.random() < 0.7:
                gid = f"ghost_{uuid.uuid4().hex[:12]}"
                cur.execute(
                    """INSERT INTO ghost_containers
                       (ghost_id, user_id, amount, recipient_id, recipient_account, recipient_bank,
                        status, cooling_window_minutes, risk_score, explanation, created_at, expires_at, resolved_at)
                       VALUES (?, ?, ?, 'unknown', ?, ?, 'CANCELLED', 30, ?, 'Seeded historical containment.', ?, ?, ?)""",
                    (gid, user_id, amount, acct, tmpl["bank"], score, ts.isoformat(),
                     (ts + timedelta(minutes=30)).isoformat(), (ts + timedelta(minutes=8)).isoformat()),
                )
        created += 1
    return created
