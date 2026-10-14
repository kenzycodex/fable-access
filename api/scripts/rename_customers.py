"""Rename demo customers' ids so they match their names, keeping all history.

Customer ids used to be "{institution}_{archetype}" ("ecobank_chioma") while the
customer shown beside it was "Kelechi Obi". They now follow the person
("ecobank_kelechi"). This moves existing customers to the new ids, in every table
that stores one, so transactions, balances, PINs, passkeys, holds and audit
history all stay with the same person.

It is careful, because it rewrites live data:

* Dry run by default. Nothing changes unless you pass --apply.
* One transaction. It changes everything or nothing.
* It only renames the three demo archetypes' ids, and only when the old id exists
  and the new one does not. A real integrator's customer ids are never touched.
* It checks that no table gained or lost a row, that no old id is left behind, and
  that SQLite's integrity check passes. Any failure rolls it all back.
* Old ids are kept in `user_aliases`.
* Running it again after it has run is a no-op.

Usage, on the server, with the API stopped so nothing writes mid-change:

    cd /var/www/fable/api
    docker compose stop api
    docker compose run --rm api python scripts/rename_customers.py
    docker compose run --rm api python scripts/rename_customers.py --apply
    docker compose up -d api

Take a backup first (docs/PIN-RECOVERY.md shows how). Pass one or more institution
ids to limit it, for example `rename_customers.py ecobank --apply`. Browsers that
had a customer selected in the demo bank pick the first customer again.
"""
import os
import sqlite3
import sys

sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from scripts.rename_institution import _row_counts, _tables  # noqa: E402


class RenameError(Exception):
    """A reason the rename cannot safely go ahead."""


def _exists(conn: sqlite3.Connection, tables: dict[str, list[str]], user_id: str) -> bool:
    return any(
        conn.execute(f"SELECT 1 FROM {t} WHERE user_id = ? LIMIT 1", (user_id,)).fetchone()
        for t, cols in tables.items() if "user_id" in cols
    )


def plan(conn: sqlite3.Connection, institutions: list[str] | None = None) -> dict:
    """Work out the renames. Changes nothing."""
    from agents.copilot.demo_customers import DEMO_CUSTOMERS, legacy_user_id_for, user_id_for

    tables = _tables(conn)
    ids = institutions or [r[0] for r in conn.execute("SELECT institution_id FROM institutions ORDER BY 1")]
    mapping: dict[str, str] = {}
    for inst in ids:
        if not conn.execute("SELECT 1 FROM institutions WHERE institution_id = ?", (inst,)).fetchone():
            raise RenameError(f"No institution has the id '{inst}'.")
        for c in DEMO_CUSTOMERS:
            old, new = legacy_user_id_for(inst, c["key"]), user_id_for(inst, c["key"])
            if old == new or not _exists(conn, tables, old):
                continue
            if _exists(conn, tables, new):
                raise RenameError(f"'{new}' already exists, so '{old}' cannot be renamed to it.")
            mapping[old] = new

    changes: list[tuple[str, int]] = []
    if mapping:
        marks = ",".join("?" for _ in mapping)
        for table, cols in tables.items():
            if "user_id" in cols:
                n = conn.execute(f"SELECT COUNT(*) FROM {table} WHERE user_id IN ({marks})", list(mapping)).fetchone()[0]
                if n:
                    changes.append((table, n))
        if "audit_log" in tables:
            n = sum(conn.execute("SELECT COUNT(*) FROM audit_log WHERE payload LIKE ?", (f'%"{u}"%',)).fetchone()[0] for u in mapping)
            if n:
                changes.append(("audit_log (payload)", n))
    return {"tables": tables, "mapping": mapping, "changes": changes}


def apply(conn: sqlite3.Connection, the_plan: dict) -> None:
    """Make the change inside the caller's transaction, then verify it."""
    tables, mapping = the_plan["tables"], the_plan["mapping"]
    before = _row_counts(conn, tables)

    for table, cols in tables.items():
        if "user_id" in cols:
            for old, new in mapping.items():
                conn.execute(f"UPDATE {table} SET user_id = ? WHERE user_id = ?", (new, old))
    if "audit_log" in tables:
        for old, new in mapping.items():
            conn.execute("UPDATE audit_log SET payload = REPLACE(payload, ?, ?) WHERE payload LIKE ?",
                         (f'"{old}"', f'"{new}"', f'%"{old}"%'))

    conn.execute("""CREATE TABLE IF NOT EXISTS user_aliases (
        alias TEXT PRIMARY KEY, user_id TEXT NOT NULL, created_at TEXT DEFAULT (datetime('now')))""")
    for old, new in mapping.items():
        conn.execute("INSERT OR REPLACE INTO user_aliases (alias, user_id) VALUES (?, ?)", (old, new))

    after_tables = _tables(conn)
    # The alias table gains rows by design; every other table must be unchanged.
    after = {t: conn.execute(f"SELECT COUNT(*) FROM {t}").fetchone()[0] for t in before if t != "user_aliases"}
    expected = {t: n for t, n in before.items() if t != "user_aliases"}
    if after != expected:
        diff = {t: (expected[t], after.get(t)) for t in expected if expected[t] != after.get(t)}
        raise RenameError(f"Row counts changed, which should never happen: {diff}")
    if mapping:
        marks = ",".join("?" for _ in mapping)
        for table, cols in after_tables.items():
            if "user_id" in cols and table != "user_aliases":
                left = conn.execute(f"SELECT COUNT(*) FROM {table} WHERE user_id IN ({marks})", list(mapping)).fetchone()[0]
                if left:
                    raise RenameError(f"{left} row(s) in {table} still use an old customer id.")
    if conn.execute("PRAGMA integrity_check").fetchone()[0] != "ok":
        raise RenameError("SQLite's integrity check failed after the change.")


def rename(conn: sqlite3.Connection, institutions: list[str] | None, do_apply: bool) -> dict:
    conn.isolation_level = None  # explicit transaction control
    conn.execute("BEGIN IMMEDIATE")
    try:
        the_plan = plan(conn, institutions)
        if do_apply and the_plan["mapping"]:
            apply(conn, the_plan)
            conn.execute("COMMIT")
        else:
            conn.execute("ROLLBACK")
        return the_plan
    except Exception:
        conn.execute("ROLLBACK")
        raise


def main(argv: list[str]) -> int:
    institutions = [a.strip().lower() for a in argv if not a.startswith("--")] or None
    do_apply = "--apply" in argv

    from core import config

    conn = sqlite3.connect(config.DB_PATH, timeout=30)
    print(f"Database: {config.DB_PATH}")
    try:
        result = rename(conn, institutions, do_apply)
    except RenameError as exc:
        print(f"\nNot changed. {exc}")
        return 1

    if not result["mapping"]:
        print("\nNothing to rename: every demo customer already has a name-based id.")
        return 0

    print(f"\n{'APPLIED' if do_apply else 'DRY RUN'}")
    print("\nCustomer ids:")
    for old, new in result["mapping"].items():
        print(f"  {old}  ->  {new}")
    print("\nRows affected:")
    for table, n in result["changes"]:
        print(f"  {table:<26}{n}")
    if do_apply:
        print("\nDone. Start the API again.")
    else:
        print("\nNothing was changed. Run again with --apply to make the change.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
