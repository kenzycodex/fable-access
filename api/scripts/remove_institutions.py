"""Remove institutions and everything that belongs to them, keeping only the ones you name.

Use it to clear demo or test banks out of a database, leaving just the institution(s)
you want, for example only `ecobank`:

    python scripts/remove_institutions.py --keep ecobank            # dry run
    python scripts/remove_institutions.py --keep ecobank --apply

This is DESTRUCTIVE and cannot be undone, so it is careful:

* Dry run by default. It lists what would be deleted and changes nothing until
  you pass --apply.
* You must name what to keep. It refuses to run if the kept institution does not
  exist, or if that would leave the database with none.
* Everything tagged with another institution goes: its customers' transactions,
  holds, ledger, PINs, passkeys, devices, notifications, audit events, admins, API
  keys, branding, webhooks, policy and aliases. Rows tagged with no institution
  (platform-level events) stay. Rows belonging to the kept institution are never
  touched, and the script checks their row counts are identical afterwards.
* One transaction: it removes everything or nothing. SQLite's integrity check
  runs before it commits.

Run it with the API stopped, so nothing writes while it works. Take a backup
first. On the server:

    cd /var/www/fable/api
    docker compose stop api
    docker compose run --rm api python scripts/remove_institutions.py --keep ecobank
    docker compose run --rm api python scripts/remove_institutions.py --keep ecobank --apply
    docker compose up -d api
"""
import os
import sqlite3
import sys

sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from scripts.rename_institution import _tables  # noqa: E402


class RemoveError(Exception):
    """A reason the removal cannot safely go ahead."""


def _marks(values) -> str:
    return ",".join("?" for _ in values)


def plan(conn: sqlite3.Connection, keep: list[str]) -> dict:
    """Work out what would be removed. Changes nothing."""
    if not keep:
        raise RemoveError("Name at least one institution to keep, e.g. --keep ecobank.")
    tables = _tables(conn)
    for inst in keep:
        if not conn.execute("SELECT 1 FROM institutions WHERE institution_id = ?", (inst,)).fetchone():
            raise RemoveError(f"No institution has the id '{inst}', so there is nothing to keep.")

    keep_marks = _marks(keep)
    removed_institutions = [r[0] for r in conn.execute(
        f"SELECT institution_id FROM institutions WHERE institution_id NOT IN ({keep_marks}) ORDER BY 1", keep)]

    # Every institution id that appears anywhere and is not kept, including
    # orphans that have rows but no institutions record.
    seen: set[str] = set(removed_institutions)
    for table, cols in tables.items():
        if "institution_id" in cols:
            seen.update(r[0] for r in conn.execute(
                f"SELECT DISTINCT institution_id FROM {table} "
                f"WHERE institution_id IS NOT NULL AND institution_id NOT IN ({keep_marks})", keep))

    # Customers of the removed institutions, and never anyone who also belongs
    # to a kept one.
    users: set[str] = set()
    kept_users: set[str] = set()
    for table, cols in tables.items():
        if "user_id" in cols and "institution_id" in cols:
            users.update(r[0] for r in conn.execute(
                f"SELECT DISTINCT user_id FROM {table} WHERE user_id IS NOT NULL "
                f"AND institution_id IS NOT NULL AND institution_id NOT IN ({keep_marks})", keep))
            kept_users.update(r[0] for r in conn.execute(
                f"SELECT DISTINCT user_id FROM {table} WHERE user_id IS NOT NULL "
                f"AND institution_id IN ({keep_marks})", keep))
    users -= kept_users

    emails = [r[0] for r in conn.execute(
        f"SELECT email FROM admins WHERE institution_id NOT IN ({keep_marks})", keep)] if "admins" in tables else []

    changes: list[tuple[str, int]] = []
    for table, cols in tables.items():
        n = 0
        if "institution_id" in cols:
            n += conn.execute(
                f"SELECT COUNT(*) FROM {table} WHERE institution_id IS NOT NULL AND institution_id NOT IN ({keep_marks})",
                keep).fetchone()[0]
        if "user_id" in cols and "institution_id" not in cols and users:
            n += conn.execute(f"SELECT COUNT(*) FROM {table} WHERE user_id IN ({_marks(users)})", list(users)).fetchone()[0]
        if table == "user_aliases" and users:
            n += conn.execute(f"SELECT COUNT(*) FROM user_aliases WHERE user_id IN ({_marks(users)})", list(users)).fetchone()[0]
        if table == "password_resets" and emails:
            n += conn.execute(f"SELECT COUNT(*) FROM password_resets WHERE email IN ({_marks(emails)})", emails).fetchone()[0]
        if n:
            changes.append((table, n))

    return {"tables": tables, "keep": keep, "institutions": sorted(seen), "users": sorted(users),
            "emails": emails, "changes": changes}


def _kept_counts(conn: sqlite3.Connection, tables: dict[str, list[str]], keep: list[str]) -> dict[str, int]:
    """Row counts for everything that belongs to the kept institutions."""
    out = {}
    for table, cols in tables.items():
        if "institution_id" in cols:
            out[table] = conn.execute(
                f"SELECT COUNT(*) FROM {table} WHERE institution_id IN ({_marks(keep)})", keep).fetchone()[0]
    return out


def apply(conn: sqlite3.Connection, the_plan: dict) -> None:
    """Delete inside the caller's transaction, then verify."""
    tables, keep, users, emails = the_plan["tables"], the_plan["keep"], the_plan["users"], the_plan["emails"]
    kept_before = _kept_counts(conn, tables, keep)
    keep_marks = _marks(keep)

    # Tables that identify rows only by customer or email go first, while the
    # admins and customers they point at still exist.
    if emails and "password_resets" in tables:
        conn.execute(f"DELETE FROM password_resets WHERE email IN ({_marks(emails)})", emails)
    if users:
        for table, cols in tables.items():
            if "user_id" in cols and "institution_id" not in cols:
                conn.execute(f"DELETE FROM {table} WHERE user_id IN ({_marks(users)})", users)
        if "user_aliases" in tables:
            conn.execute(f"DELETE FROM user_aliases WHERE user_id IN ({_marks(users)})", users)

    for table, cols in tables.items():
        if "institution_id" in cols:
            conn.execute(
                f"DELETE FROM {table} WHERE institution_id IS NOT NULL AND institution_id NOT IN ({keep_marks})", keep)

    # Verify. Any failure raises, and the caller rolls the whole thing back.
    for table, cols in tables.items():
        if "institution_id" in cols:
            left = conn.execute(
                f"SELECT COUNT(*) FROM {table} WHERE institution_id IS NOT NULL AND institution_id NOT IN ({keep_marks})",
                keep).fetchone()[0]
            if left:
                raise RemoveError(f"{left} row(s) in {table} still belong to a removed institution.")
    if _kept_counts(conn, tables, keep) != kept_before:
        raise RemoveError("A kept institution's rows changed, which should never happen.")
    if conn.execute("PRAGMA integrity_check").fetchone()[0] != "ok":
        raise RemoveError("SQLite's integrity check failed after the change.")


def remove(conn: sqlite3.Connection, keep: list[str], do_apply: bool) -> dict:
    conn.isolation_level = None  # explicit transaction control
    conn.execute("BEGIN IMMEDIATE")
    try:
        the_plan = plan(conn, keep)
        if do_apply and the_plan["changes"]:
            apply(conn, the_plan)
            conn.execute("COMMIT")
        else:
            conn.execute("ROLLBACK")
        return the_plan
    except Exception:
        conn.execute("ROLLBACK")
        raise


def main(argv: list[str]) -> int:
    keep: list[str] = []
    for i, a in enumerate(argv):
        if a == "--keep" and i + 1 < len(argv):
            keep.append(argv[i + 1].strip().lower())
        elif a.startswith("--keep="):
            keep.append(a.split("=", 1)[1].strip().lower())
    if not keep:
        print(__doc__)
        return 2
    do_apply = "--apply" in argv

    import config

    conn = sqlite3.connect(config.DB_PATH, timeout=30)
    print(f"Database: {config.DB_PATH}")
    try:
        result = remove(conn, keep, do_apply)
    except RemoveError as exc:
        print(f"\nNot changed. {exc}")
        return 1

    print(f"\nKeeping: {', '.join(keep)}")
    if not result["changes"]:
        print("Nothing to remove: no other institution has any data here.")
        return 0

    print(f"\n{'REMOVED' if do_apply else 'DRY RUN, would remove'}:")
    print(f"  institutions: {', '.join(result['institutions']) or '-'}")
    print(f"  customers:    {len(result['users'])}")
    print("\nRows affected:")
    for table, n in result["changes"]:
        print(f"  {table:<24}{n}")

    if do_apply:
        conn.execute("PRAGMA wal_checkpoint(TRUNCATE)")
        conn.execute("VACUUM")
        print("\nDone. Start the API again.")
    else:
        print("\nNothing was changed. Run again with --apply to remove them.")
    conn.close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
