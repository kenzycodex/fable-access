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


def ensure_from_env() -> bool:
    """At startup: set the demo up when its key is configured. Does nothing
    otherwise, so only the Forge deployment ever creates this institution."""
    raw = os.getenv("FORGE_DEMO_API_KEY", "").strip()
    if not raw:
        return False
    ensure_demo(raw)
    logger.info("The Forge demo institution is ready.")
    return True
