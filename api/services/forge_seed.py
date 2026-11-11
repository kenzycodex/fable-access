"""The Forge demo's institution, customers and API key, set up by code.

The API's storage in the cluster is temporary (docs/DEPLOY-FORGE.md), so every
time the API pod starts the database is empty. This puts the demo back on its
own: the live institution `forge`, the five customers (each with the demo PIN)
and an API key. When FORGE_DEMO_API_KEY is set, that is the key, so the website
(which holds the same value from the `forge-demo` secret) keeps working across
restarts with no manual step. Everything here is safe to run again.
"""
import logging
import os

from core import apikeys, customers, security
from core.db import cursor
from core.tenancy import register_institution

logger = logging.getLogger("fable.forge")

INSTITUTION = "forge"
# The sandbox's own synthetic people. Synthetic data only.
DEMO_PIN = "1234"
CUSTOMERS = {
    "demo_adaeze": ("Adaeze Chiamaka Okonkwo", "Salaried"),
    "demo_babatunde": ("Babatunde Olumide Adeyemi", "Trader"),
    "demo_musa": ("Musa Ibrahim Abdullahi", "Salaried"),
    "demo_efosa": ("Efosa Godwin Osagie", "Student"),
    "demo_mama": ("Mama Nkechi Provisions Ltd", "Trader"),
}
MIN_KEY_LENGTH = 24


def valid_key(raw: str | None) -> bool:
    return bool(raw) and raw.startswith(apikeys.PREFIX) and len(raw) >= MIN_KEY_LENGTH


def ensure_demo(raw_key: str | None = None, *, new_key: bool = False) -> dict:
    """Make the demo exist. Returns what was done: the customers, and the key
    only when this call issued a new one (it cannot be recovered later)."""
    if raw_key is not None and not valid_key(raw_key):
        raise ValueError(f"The demo API key must start with {apikeys.PREFIX} and be at least {MIN_KEY_LENGTH} characters.")

    register_institution(INSTITUTION, "Fable on Xtradot Bank", "team11@fable.ng")
    with cursor() as cur:
        cur.execute("UPDATE institutions SET mode = 'live' WHERE institution_id = ?", (INSTITUTION,))

    made = {}
    for ref, (name, segment) in CUSTOMERS.items():
        customer = customers.get(INSTITUTION, ref) or customers.create(
            INSTITUTION, ref, kind="real", source="console", display_name=name, segment=segment)
        if not security.status(customer["id"]).get("pin_set"):
            security.set_pin(customer["id"], DEMO_PIN, institution_id=INSTITUTION)
        made[ref] = customer["id"]

    issued = None
    with cursor() as cur:
        cur.execute("SELECT COUNT(*) AS n FROM api_keys WHERE institution_id = ? AND is_active = 1", (INSTITUTION,))
        has_key = cur.fetchone()["n"] > 0
        if raw_key is not None:
            cur.execute("SELECT 1 FROM api_keys WHERE key = ?", (apikeys.hash_key(raw_key),))
            if cur.fetchone() is None:
                apikeys.insert(cur, raw_key, INSTITUTION, "Fable on Xtradot Bank", "team11@fable.ng")
        elif new_key or not has_key:
            issued = apikeys.generate()
            cur.execute("UPDATE api_keys SET is_active = 0 WHERE institution_id = ?", (INSTITUTION,))
            apikeys.insert(cur, issued, INSTITUTION, "Fable on Xtradot Bank", "team11@fable.ng")
    return {"customers": made, "issued_key": issued}


def ensure_bank(institution_id: str, email: str, password: str) -> dict:
    """The bank connected to the Xtradot sandbox, set up as a bank would be:
    a sandbox institution with an owner who signs in to the console, and its
    customers and their past transfers brought in through the console's own
    import. Safe to run again: the import skips what it already has."""
    from core.utils import hash_password
    from services import forge_history, imports

    if not email or "@" not in email or len(password) < 12:
        raise ValueError("The console login needs an email and a password of at least 12 characters.")
    register_institution(institution_id, "Xtradot Bank", email)
    with cursor() as cur:
        cur.execute("UPDATE institutions SET mode = 'sandbox' WHERE institution_id = ?", (institution_id,))
        cur.execute("SELECT 1 FROM admins WHERE email = ?", (email.lower(),))
        if cur.fetchone() is None:
            cur.execute("INSERT INTO admins (email, institution_id, hashed_password, role, name, active) "
                        "VALUES (?, ?, ?, 'owner', 'Team Fable', 1)",
                        (email.lower(), institution_id, hash_password(password)))
    made = imports.import_batch(institution_id, "customers", forge_history.customer_rows(),
                                sandbox=True, actor="forge-seed")
    history = forge_history.transaction_rows()
    inserted = 0
    for start in range(0, len(history), imports.MAX_ROWS_PER_BATCH):
        inserted += imports.import_batch(institution_id, "transactions", history[start:start + imports.MAX_ROWS_PER_BATCH],
                                         sandbox=True, actor="forge-seed")["inserted"]
    for account in forge_history.HABITS:
        customer = customers.get(institution_id, account)
        if customer and not security.status(customer["id"]).get("pin_set"):
            security.set_pin(customer["id"], DEMO_PIN, institution_id=institution_id)
    return {"customers": made["inserted"], "history": inserted}


def ensure_from_env() -> bool:
    """At startup: set the demo up when it is configured. Does nothing
    otherwise, so only the Forge deployment ever creates these institutions."""
    did = False
    raw = os.getenv("FORGE_DEMO_API_KEY", "").strip()
    if raw:
        ensure_demo(raw)
        logger.info("The Forge demo institution is ready.")
        did = True
    bank = os.getenv("FORGE_BRIDGE_INSTITUTION", "").strip()
    email = os.getenv("FORGE_CONSOLE_EMAIL", "").strip()
    password = os.getenv("FORGE_CONSOLE_PASSWORD", "")
    if bank and email and password:
        result = ensure_bank(bank, email, password)
        logger.info("The bank connected to the Xtradot sandbox is ready: %s customers and %s past transfers "
                    "imported.", result["customers"], result["history"])
        did = True
    return did
