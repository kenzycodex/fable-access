"""Set up the live demo institution for the Forge cluster.

Creates (or finds) the institution `forge`, puts it in live mode so the bank's
balance is the only one used, adds the demo customers (one per bank account in
the sandbox's test data, each with the demo PIN), and issues the API key the
website's demo page uses. Safe to run again: nothing is duplicated, and a new
key is issued only with --new-key.

    kubectl exec deploy/api -- python scripts/forge_seed.py

The key is printed once and is never stored in the clear. Put it in the
cluster secret straight away (docs/DEPLOY-FORGE.md).
"""
import argparse
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from core import apikeys, customers, security  # noqa: E402
from core.db import cursor  # noqa: E402
from core.tenancy import register_institution  # noqa: E402

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


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--new-key", action="store_true", help="issue a fresh API key and retire the old ones")
    args = parser.parse_args()

    register_institution(INSTITUTION, "Fable on Xtradot Bank", "team11@fable.ng")
    with cursor() as cur:
        cur.execute("UPDATE institutions SET mode = 'live' WHERE institution_id = ?", (INSTITUTION,))
        cur.execute("SELECT COUNT(*) AS n FROM api_keys WHERE institution_id = ? AND is_active = 1", (INSTITUTION,))
        has_key = cur.fetchone()["n"] > 0

    for ref, (name, segment) in CUSTOMERS.items():
        customer = customers.get(INSTITUTION, ref) or customers.create(
            INSTITUTION, ref, kind="real", source="console", display_name=name, segment=segment)
        if not security.status(customer["id"]).get("pin_set"):
            security.set_pin(customer["id"], DEMO_PIN, institution_id=INSTITUTION)
        print(f"customer {ref}: {customer['id']}")

    if args.new_key or not has_key:
        raw = apikeys.generate()
        with cursor() as cur:
            cur.execute("UPDATE api_keys SET is_active = 0 WHERE institution_id = ?", (INSTITUTION,))
            apikeys.insert(cur, raw, INSTITUTION, "Fable on Xtradot Bank", "team11@fable.ng")
        print("FORGE_DEMO_API_KEY (shown once):", raw)
    else:
        print("An API key already exists. Run with --new-key to issue another.")


if __name__ == "__main__":
    main()
