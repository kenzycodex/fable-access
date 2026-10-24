"""Check, and if needed clear, a customer's transaction PIN.

A PIN is stored only as a salted hash, so it can never be read back. When one
is forgotten the fix is to clear it: the customer then chooses a new one the
next time a verification asks for it.

Usage (from the api directory, or inside the container):

    python scripts/pin_tool.py list                  # who has a PIN, who is locked
    python scripts/pin_tool.py check <user_id>       # one customer's status
    python scripts/pin_tool.py clear <user_id>       # remove their PIN and any lock
    python scripts/pin_tool.py clear --all           # clear every customer's PIN

On the server:

    cd /var/www/fable/api
    docker compose exec api python scripts/pin_tool.py list
    docker compose exec api python scripts/pin_tool.py clear ecobank_segun

`check` and `list` only read. `clear` asks before it changes anything.
"""
import os
import sys

sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from core import security  # noqa: E402
from core.db import cursor  # noqa: E402


def _all_rows() -> list[dict]:
    with cursor() as cur:
        cur.execute(
            """SELECT user_id, institution_id, pin_hash IS NOT NULL AS pin_set,
                      failed_attempts, locked_until, pin_set_at
               FROM user_security ORDER BY institution_id, user_id"""
        )
        return [dict(r) for r in cur.fetchall()]


def _print_rows(rows: list[dict]) -> None:
    if not rows:
        print("No customer has any security settings yet, so nobody has a PIN.")
        return
    print(f"{'user_id':<34}{'institution':<20}{'PIN':<8}{'failed':<8}locked until")
    for r in rows:
        print(
            f"{r['user_id']:<34}{(r['institution_id'] or '-'):<20}"
            f"{'set' if r['pin_set'] else 'none':<8}{r['failed_attempts'] or 0:<8}"
            f"{r['locked_until'] or '-'}"
        )


def _confirm(prompt: str) -> bool:
    try:
        return input(f"{prompt} [y/N] ").strip().lower() == "y"
    except EOFError:
        return False


def main(argv: list[str]) -> int:
    if not argv or argv[0] in ("-h", "--help", "help"):
        print(__doc__)
        return 0

    command = argv[0]

    if command == "list":
        _print_rows(_all_rows())
        return 0

    if command == "check" and len(argv) == 2:
        st = security.status(argv[1])
        print(f"user:        {argv[1]}")
        print(f"PIN set:     {st['pin_set']}" + (f" (since {st['pin_set_at']})" if st["pin_set_at"] else ""))
        print(f"locked:      {st['pin_locked']}" + (f" until {st['pin_locked_until']}" if st["pin_locked"] else ""))
        print(f"failed:      {st['failed_attempts']}")
        print(f"passkeys:    {st['passkey_count']}")
        print(f"codes go to: {st['contact_email'] or st['contact_phone'] or 'nowhere registered'}")
        return 0

    if command == "clear" and len(argv) == 2:
        targets = [r["user_id"] for r in _all_rows() if r["pin_set"]] if argv[1] == "--all" else [argv[1]]
        if not targets:
            print("No PINs are set. Nothing to clear.")
            return 0
        print("Will clear the PIN for:\n  " + "\n  ".join(targets))
        if not _confirm("Clear these PINs?"):
            print("Cancelled. Nothing changed.")
            return 1
        for user_id in targets:
            security.clear_pin(user_id)
        print(f"Cleared {len(targets)} PIN(s). Each customer sets a new one at their next verification.")
        return 0

    print(__doc__)
    return 2


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
