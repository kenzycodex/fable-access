"""Move a hold's window into the past, for the browser expiry test (e2e/).

Refuses unless FABLE_DB_PATH names a throwaway e2e database.

    FABLE_DB_PATH=/tmp/fable-e2e.db python scripts/e2e_age_hold.py <customer reference>
"""
import os
import sys
from datetime import datetime, timedelta, timezone

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))


def main() -> None:
    if "e2e" not in os.path.basename(os.environ.get("FABLE_DB_PATH", "")):
        raise SystemExit("Refusing: FABLE_DB_PATH must name a throwaway e2e database file.")
    from core.db import cursor

    past = datetime.now(timezone.utc) - timedelta(minutes=2)
    with cursor() as cur:
        cur.execute(
            "UPDATE ghost_containers SET expires_at = ? WHERE status = 'HELD' AND user_id IN "
            "(SELECT id FROM customers WHERE external_ref = ?)",
            (past.isoformat(), sys.argv[1]),
        )
        print(f"aged {cur.rowcount} hold(s)")


if __name__ == "__main__":
    main()
