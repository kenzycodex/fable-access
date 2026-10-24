"""Print the current authenticator code for the e2e operator, and allow it to
be used again (browser tests sign in more than once in a 30-second step).

Refuses unless FABLE_DB_PATH names a throwaway e2e database file."""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))


def main() -> None:
    if "e2e" not in os.path.basename(os.environ.get("FABLE_DB_PATH", "")):
        raise SystemExit("Refusing: FABLE_DB_PATH must name a throwaway e2e database file.")
    from core import totp
    from core.db import cursor
    from scripts.e2e_seed import OPERATOR, OPERATOR_TOTP

    with cursor() as cur:
        cur.execute("UPDATE operators SET totp_last_step = NULL WHERE email = ?", (OPERATOR,))
    print(totp.code_at(OPERATOR_TOTP, totp.current_step()))


if __name__ == "__main__":
    main()
