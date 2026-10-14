"""Create a Fable operator account from the server's shell.

How the first platform owner is made. Every later operator is invited from the
operator platform itself. The account gets a password here; the operator sets
up an authenticator app the first time they sign in at /operator.

Usage, on the server:

    cd /var/www/fable/api
    docker compose exec api python scripts/create_operator.py you@company.com "Your Name"

You will be asked for the password twice (12 characters at least). Pass
--role platform_admin or --role support for a less privileged account; the
default is platform_owner.
"""
import argparse
import getpass
import os
import sys

sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

MIN_PASSWORD = 12


def create(email: str, name: str | None, role: str, password: str) -> dict:
    """Create or reset an operator with this password. MFA is enrolled at first sign-in."""
    from core import operators
    from core.db import cursor
    from core.utils import hash_password

    email = email.strip().lower()
    if role not in operators.ROLES:
        raise ValueError(f"Role must be one of {', '.join(operators.ROLES)}.")
    if len(password) < MIN_PASSWORD:
        raise ValueError(f"Use a password of at least {MIN_PASSWORD} characters.")
    with cursor() as cur:
        cur.execute(
            """INSERT INTO operators (email, name, role, hashed_password, active, totp_enabled, totp_secret)
               VALUES (?, ?, ?, ?, ?, 0, NULL)
               ON CONFLICT(email) DO UPDATE SET name = COALESCE(excluded.name, name), role = excluded.role,
                   hashed_password = excluded.hashed_password, active = excluded.active,
                   totp_enabled = 0, totp_secret = NULL, session_version = session_version + 1""",
            (email, name, role, hash_password(password), operators.ACTIVE),
        )
    return operators.public(operators.get(email))


def main() -> int:
    parser = argparse.ArgumentParser(description="Create a Fable operator account.")
    parser.add_argument("email")
    parser.add_argument("name", nargs="?")
    parser.add_argument("--role", default="platform_owner")
    args = parser.parse_args()

    password = getpass.getpass("Password: ")
    if password != getpass.getpass("Repeat password: "):
        print("The passwords don't match.")
        return 1
    try:
        op = create(args.email, args.name, args.role, password)
    except ValueError as exc:
        print(exc)
        return 1
    print(f"Created {op['email']} as {op['role']}. Sign in at /operator and set up your authenticator app.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
