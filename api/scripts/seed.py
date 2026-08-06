"""Seed the default admin and an API key for the demo tenant.

The password was hardcoded to "fable-demo" and committed to a public
repository, so anyone reading the source could sign into the console. It is now
taken from the environment, or generated and printed once.

Usage:
    python scripts/seed.py                        # generates a password
    FABLE_DEMO_ADMIN_PASSWORD=... python scripts/seed.py

Note this duplicates the startup seeding in main.py, which runs automatically.
This script exists for seeding a database without booting the app; prefer
letting the app do it.
"""
import os
import secrets
import sys

sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from utils import hash_password
from db import cursor, slugify_institution

email = os.getenv("FABLE_DEMO_ADMIN_EMAIL", "risk@meridian.ng")
password = os.getenv("FABLE_DEMO_ADMIN_PASSWORD", "").strip() or secrets.token_urlsafe(12)
generated = not os.getenv("FABLE_DEMO_ADMIN_PASSWORD", "").strip()
institution_id = os.getenv("FABLE_DEMO_ADMIN_INSTITUTION", "meridian")
institution_name = "Meridian MFB"
api_key = f"fbl_live_{secrets.token_hex(16)}"

with cursor() as cur:
    cur.execute("SELECT 1 FROM admins WHERE email = ?", (email,))
    if cur.fetchone():
        print(f"Demo user {email} already exists; nothing changed.")
    else:
        cur.execute(
            "INSERT INTO admins (email, institution_id, hashed_password) VALUES (?, ?, ?)",
            (email, institution_id, hash_password(password)),
        )
        # institution_id was omitted here, so the key was orphaned from its
        # tenant and every lookup fell back to deriving it from the name.
        cur.execute(
            "INSERT INTO api_keys (key, institution_name, admin_email, institution_id) "
            "VALUES (?, ?, ?, ?)",
            (api_key, institution_name, email, institution_id),
        )
        print(f"Seeded {email} for institution '{institution_id}'.")
        if generated:
            print(f"  Generated password: {password}")
            print("  Record it now. Only the hash is stored.")
        print(f"  API key: {api_key}")
