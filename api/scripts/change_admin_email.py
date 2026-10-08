"""Change an institution admin's login email, keeping their password.

Usage (from the api directory, or inside the container):

    python scripts/change_admin_email.py old@example.com demo@fable.ng

On the server:

    cd /var/www/fable/api
    docker compose exec api python scripts/change_admin_email.py old@example.com demo@fable.ng

It updates the three places the address is stored: the login (`admins`), the
institution's API-key record, and the institution's contact address. Nothing
else changes, so the password, the API key and every customer stay as they are.

After running it, also set FABLE_DEMO_ADMIN_EMAIL in api/.env to the new
address. Startup creates the default admin when no row has that email, so
leaving the old value there would quietly create a second admin with the old
address on the next restart.
"""
import os
import re
import sys

sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from db import cursor  # noqa: E402

EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")


def main() -> int:
    if len(sys.argv) != 3:
        print(__doc__)
        return 2

    old, new = sys.argv[1].strip().lower(), sys.argv[2].strip().lower()
    if not EMAIL_RE.match(new):
        print(f"'{new}' does not look like an email address.")
        return 2

    with cursor() as cur:
        cur.execute("SELECT institution_id FROM admins WHERE lower(email) = ?", (old,))
        row = cur.fetchone()
        if not row:
            print(f"No admin with the email {old}.")
            return 1
        cur.execute("SELECT 1 FROM admins WHERE lower(email) = ?", (new,))
        if cur.fetchone():
            print(f"An admin with {new} already exists. Nothing changed.")
            return 1

        institution_id = row["institution_id"]
        cur.execute("UPDATE admins SET email = ? WHERE lower(email) = ?", (new, old))
        cur.execute(
            "UPDATE api_keys SET admin_email = ? WHERE lower(admin_email) = ?", (new, old)
        )
        cur.execute(
            "UPDATE institutions SET contact_email = ? WHERE institution_id = ?",
            (new, institution_id),
        )

    print(f"Admin for '{institution_id}' is now {new}. The password is unchanged.")
    print("Remember to set FABLE_DEMO_ADMIN_EMAIL in api/.env and NEXT_PUBLIC_DEMO_EMAIL on Vercel.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
