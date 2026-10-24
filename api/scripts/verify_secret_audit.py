"""Check that the integration-key audit trail has not been edited or cut.

Each row of secret_audit carries the hash of the row before it. Changing,
deleting or inserting any row breaks every hash after it, which this finds.

    docker compose exec -T api python scripts/verify_secret_audit.py

Exit code 0 when intact, 1 when broken.
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))


def main() -> int:
    from services.secret_admin import verify_chain

    ok, rows, broken = verify_chain()
    if ok:
        print(f"Intact: {rows} entries, every hash matches.")
        return 0
    print(f"BROKEN at entry {broken} (of {rows}). The trail was altered from there on. "
          "Compare with the log stream copy (docker compose logs api | grep secret_audit).")
    return 1


if __name__ == "__main__":
    sys.exit(main())
