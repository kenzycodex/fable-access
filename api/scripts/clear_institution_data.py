"""Clear one institution's customers and their activity, keeping the institution.

For a bank that tried Fable with test data and is now ready to import its real
customers: its customers, decisions, history, holds, balances, verification
factors, notifications and imports go; its console members, API keys, branding,
risk policy, webhooks and audit trail stay.

    python scripts/clear_institution_data.py ecobank                      # dry run
    python scripts/clear_institution_data.py ecobank --apply --backup /data/before-clear.db

DESTRUCTIVE, so it is careful:

* Dry run by default: it counts what would be deleted and changes nothing.
* With --apply it first writes a backup (with SQLite's backup API, safe while
  the database is in WAL mode) if you pass --backup, then deletes everything in
  one transaction, checks that nothing of this institution's customers is left
  and that the database passes SQLite's integrity check, and only then commits.
* Other institutions are never touched; their row counts are checked.
* The clearing itself is recorded in the institution's audit trail.

Run it with the API stopped, so nothing writes while it works:

    cd /var/www/fable/api
    docker compose stop api
    docker compose run --rm api python scripts/clear_institution_data.py ecobank
    docker compose run --rm api python scripts/clear_institution_data.py ecobank --apply --backup /data/before-clear.db
    docker compose up -d api

Delete the backup once you have checked the result: it holds customer data.
"""
import argparse
import json
import os
import sqlite3
import sys

sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from scripts.rename_institution import _tables  # noqa: E402

# What belongs to the institution itself and survives a clear.
KEEP = {
    "institutions", "admins", "api_keys", "institution_branding", "institution_settings", "webhooks",
    "webhook_deliveries", "audit_log", "institution_aliases", "password_resets", "operators",
    "operator_invites", "login_failures", "explanation_cache",
}


class ClearError(Exception):
    """A reason the clear cannot safely go ahead."""


def _marks(values) -> str:
    return ",".join("?" for _ in values)


def plan(conn: sqlite3.Connection, institution_id: str) -> dict:
    tables = {t: c for t, c in _tables(conn).items() if conn.execute(
        "SELECT type FROM sqlite_master WHERE name = ?", (t,)).fetchone()[0] == "table"}
    if not conn.execute("SELECT 1 FROM institutions WHERE institution_id = ?", (institution_id,)).fetchone():
        raise ClearError(f"No institution has the id '{institution_id}'.")

    users: set[str] = set()
    for table, cols in tables.items():
        if "user_id" in cols and "institution_id" in cols:
            users.update(r[0] for r in conn.execute(
                f"SELECT DISTINCT user_id FROM {table} WHERE institution_id = ? AND user_id IS NOT NULL", (institution_id,)))
    if "customers" in tables:
        users.update(r[0] for r in conn.execute("SELECT id FROM customers WHERE institution_id = ?", (institution_id,)))
    jobs = [r[0] for r in conn.execute("SELECT id FROM import_jobs WHERE institution_id = ?", (institution_id,))] \
        if "import_jobs" in tables else []

    changes: list[tuple[str, int]] = []
    for table, cols in tables.items():
        if table in KEEP:
            continue
        n = 0
        if "institution_id" in cols:
            n = conn.execute(f"SELECT COUNT(*) FROM {table} WHERE institution_id = ?", (institution_id,)).fetchone()[0]
        elif "user_id" in cols and users:
            n = conn.execute(f"SELECT COUNT(*) FROM {table} WHERE user_id IN ({_marks(users)})", list(users)).fetchone()[0]
        elif table == "import_rows" and jobs:
            n = conn.execute(f"SELECT COUNT(*) FROM import_rows WHERE job_id IN ({_marks(jobs)})", jobs).fetchone()[0]
        if n:
            changes.append((table, n))
    return {"tables": tables, "institution": institution_id, "users": sorted(users), "jobs": jobs, "changes": changes}


def _others(conn: sqlite3.Connection, tables: dict, institution_id: str) -> dict[str, int]:
    return {t: conn.execute(f"SELECT COUNT(*) FROM {t} WHERE institution_id IS NOT NULL AND institution_id != ?",
                            (institution_id,)).fetchone()[0]
            for t, cols in tables.items() if "institution_id" in cols}


def apply(conn: sqlite3.Connection, the_plan: dict) -> None:
    tables, inst, users, jobs = the_plan["tables"], the_plan["institution"], the_plan["users"], the_plan["jobs"]
    before = _others(conn, tables, inst)
    if jobs and "import_rows" in tables:
        conn.execute(f"DELETE FROM import_rows WHERE job_id IN ({_marks(jobs)})", jobs)
    for table, cols in tables.items():
        if table in KEEP:
            continue
        if "institution_id" in cols:
            conn.execute(f"DELETE FROM {table} WHERE institution_id = ?", (inst,))
        elif "user_id" in cols and users:
            conn.execute(f"DELETE FROM {table} WHERE user_id IN ({_marks(users)})", users)

    for table, cols in tables.items():
        if table not in KEEP and "institution_id" in cols:
            left = conn.execute(f"SELECT COUNT(*) FROM {table} WHERE institution_id = ?", (inst,)).fetchone()[0]
            if left:
                raise ClearError(f"{left} row(s) of {inst} are still in {table}.")
    if _others(conn, tables, inst) != before:
        raise ClearError("Another institution's row counts changed. Nothing was cleared.")
    if conn.execute("PRAGMA integrity_check").fetchone()[0] != "ok":
        raise ClearError("The database failed its integrity check. Nothing was cleared.")
    conn.execute(
        "INSERT INTO audit_log (user_id, institution_id, event_type, payload) VALUES (NULL, ?, ?, ?)",
        (inst, "institution.data_cleared", json.dumps({"tables": dict(the_plan["changes"]), "via": "script"})),
    )


def clear(conn: sqlite3.Connection, institution_id: str, do_apply: bool) -> dict:
    the_plan = plan(conn, institution_id)
    if do_apply:
        try:
            conn.execute("BEGIN IMMEDIATE")
            apply(conn, the_plan)
            conn.execute("COMMIT")
        except Exception:
            conn.execute("ROLLBACK")
            raise
    return the_plan


def main() -> int:
    from core import config

    parser = argparse.ArgumentParser(description="Clear an institution's customers and their activity.")
    parser.add_argument("institution")
    parser.add_argument("--apply", action="store_true")
    parser.add_argument("--backup", help="Write a backup here before clearing (recommended).")
    args = parser.parse_args()

    conn = sqlite3.connect(config.DB_PATH, timeout=30, isolation_level=None)
    try:
        the_plan = plan(conn, args.institution)
        print(f"{args.institution}: {len(the_plan['users'])} customer(s)")
        for table, n in the_plan["changes"]:
            print(f"  {table}: {n} row(s)")
        if not args.apply:
            print("Dry run. Nothing changed. Add --apply to clear.")
            return 0
        if args.backup:
            backup = sqlite3.connect(args.backup)
            conn.backup(backup)
            backup.close()
            print(f"Backup written to {args.backup}")
        clear(conn, args.institution, do_apply=True)
        print("Cleared. The institution, its team, keys, branding, policy, webhooks and audit trail are untouched.")
        return 0
    except ClearError as exc:
        print(f"Refused: {exc}")
        return 1
    finally:
        conn.close()


if __name__ == "__main__":
    sys.exit(main())
