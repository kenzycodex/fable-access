"""Seed a throwaway database for the browser end-to-end tests (e2e/).

Never run against a real database: it refuses unless FABLE_DB_PATH points at a
file whose name contains "e2e". Creates one sandbox institution with an owner
and an analyst, and one test customer with money, a PIN and a confirmed email,
all set up well before any test so they count as long-standing factors.

    FABLE_DB_PATH=/tmp/fable-e2e.db python scripts/e2e_seed.py
"""
import os
import sys
from datetime import datetime, timedelta, timezone

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

INSTITUTION = "e2ebank"
PASSWORD = "e2e-password-123"
# One customer per browser test, so no test's transfers change another's score
# (velocity, history). Each has money, a PIN and a confirmed email set up long
# before the tests run.
CUSTOMERS = {
    "e2e-pass": "Ada Obi",
    "e2e-flag": "Bayo Lawal",
    "e2e-cancel": "Chioma Eze",
    "e2e-release": "Dayo Musa",
    "e2e-expire": "Efe Okoro",
    "e2e-review": "Femi Ade",
    "e2e-mobile": "Grace Uche",
}


def main() -> None:
    path = os.environ.get("FABLE_DB_PATH", "")
    if "e2e" not in os.path.basename(path):
        raise SystemExit("Refusing to seed: FABLE_DB_PATH must name a throwaway e2e database file.")

    from core import customers, security
    from core.db import cursor
    from core.tenancy import register_institution
    from core.utils import hash_password
    from services import accounts as ledger

    register_institution(INSTITUTION, "E2E Bank", "risk@e2ebank.test")
    with cursor() as cur:
        for email, role in ((f"owner@{INSTITUTION}.test", "owner"), (f"analyst@{INSTITUTION}.test", "analyst")):
            cur.execute(
                "INSERT OR REPLACE INTO admins (email, institution_id, hashed_password, role, active, name) "
                "VALUES (?, ?, ?, ?, 1, ?)",
                (email, INSTITUTION, hash_password(PASSWORD), role, role.title()),
            )
    long_ago = (datetime.now(timezone.utc) - timedelta(days=30)).isoformat()
    for ref, name in CUSTOMERS.items():
        customer = customers.ensure(INSTITUTION, ref, kind="test", source="console")
        ledger.ensure_account(customer["id"], INSTITUTION, opening_balance=5_000_000)
        if not security.status(customer["id"])["pin_set"]:
            security.set_pin(customer["id"], "2580", institution_id=INSTITUTION)
        with cursor() as cur:
            cur.execute(
                "UPDATE user_security SET pin_set_at = ?, contact_email = ?, contact_email_set_at = ? WHERE user_id = ?",
                (long_ago, f"{ref}@e2ebank.test", long_ago, customer["id"]),
            )
            cur.execute("UPDATE customers SET display_name = ? WHERE id = ?", (name, customer["id"]))
    _operator()
    print(f"seeded {INSTITUTION} with {len(CUSTOMERS)} customers and an operator")


# A platform owner for the operator console, with a fixed authenticator secret
# so the browser tests can compute its codes (scripts/e2e_totp.py).
OPERATOR = "owner@fable-e2e.test"
OPERATOR_TOTP = "JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP"


def _operator() -> None:
    from core import operators
    from core.db import cursor
    from scripts.create_operator import create

    with cursor() as cur:
        cur.execute("SELECT 1 FROM operators WHERE email = ?", (OPERATOR,))
        exists = cur.fetchone()
    if not exists:
        create(OPERATOR, "E2E Owner", "platform_owner", PASSWORD)
    with cursor() as cur:
        cur.execute("UPDATE operators SET totp_enabled = 1, totp_secret = ?, totp_last_step = NULL, active = 1 "
                    "WHERE email = ?", (operators.seal(OPERATOR_TOTP), OPERATOR))


if __name__ == "__main__":
    main()
