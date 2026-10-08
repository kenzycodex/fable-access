"""Rename an institution's internal id, for example union_bank -> ecobank.

The id is the key every customer, transaction, hold, ledger entry and API key
hangs off, and customer ids are built from it ("union_bank_chioma"). Changing it
means updating all of those together. This does that in one transaction, so it
either changes everything or nothing.

It is deliberately careful, because it rewrites live data:

* Dry run by default. Nothing changes unless you pass --apply.
* It refuses an id that is taken, reserved, or malformed.
* It rewrites only this institution's customers. A customer id is renamed only
  when it is on this institution's roster or tagged to it, so another tenant whose
  id merely starts the same way is never touched.
* It checks row counts before and after, that no old id is left behind, and that
  the database passes SQLite's own integrity check. Any failure rolls it all back.
* The old id is kept as an alias, so old links, settings and open browser tabs
  that still use it keep working.

Usage, on the server, with the API stopped so nothing writes mid-change:

    cd /var/www/fable/api
    docker compose stop api
    docker compose run --rm api python scripts/rename_institution.py union_bank ecobank
    docker compose run --rm api python scripts/rename_institution.py union_bank ecobank --apply
    docker compose up -d api

Take a backup first (docs/PIN-RECOVERY.md shows how). Console logins made before
the rename stop working, so sign in to the console again afterwards.
"""
import os
import re
import sqlite3
import sys

sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

ID_PATTERN = re.compile(r"^[a-z0-9][a-z0-9_]{1,40}$")
# Not a customer id or a slug: names a route or a system tenant.
RESERVED = {"demo", "dashboard", "api", "admin", "login", "logout", "settings", "platform",
            "pricing", "docs", "health", "static", "public", "assets", "images", "fable", "v1"}


class RenameError(Exception):
    """A reason the rename cannot safely go ahead."""


def _tables(conn: sqlite3.Connection) -> dict[str, list[str]]:
    names = [r[0] for r in conn.execute(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name")]
    return {t: [r[1] for r in conn.execute(f"PRAGMA table_info({t})")] for t in names}


def _customer_ids(conn: sqlite3.Connection, tables: dict[str, list[str]], old: str) -> set[str]:
    """Every customer id that belongs to this institution.

    Taken from the tables that tag a customer with an institution, plus the demo
    roster, because a customer can exist in some tables before others.
    """
    found: set[str] = set()
    for table, cols in tables.items():
        if "user_id" in cols and "institution_id" in cols:
            for (uid,) in conn.execute(
                f"SELECT DISTINCT user_id FROM {table} WHERE institution_id = ? AND user_id IS NOT NULL", (old,)
            ):
                found.add(uid)
    try:
        from agents.copilot.demo_customers import roster_for, user_id_for
        found.update(user_id_for(old, c["key"]) for c in roster_for())
    except Exception:  # noqa: BLE001 - the roster is only a safety net
        pass
    # Only ids in the "{institution}_{key}" shape can be rewritten by prefix.
    return {u for u in found if u.startswith(old + "_")}


def _row_counts(conn: sqlite3.Connection, tables: dict[str, list[str]]) -> dict[str, int]:
    # The alias table gains a row by design, so it is not part of the check that
    # a rename neither creates nor loses any data.
    return {t: conn.execute(f"SELECT COUNT(*) FROM {t}").fetchone()[0] for t in tables if t != "institution_aliases"}


def plan(conn: sqlite3.Connection, old: str, new: str) -> dict:
    """Work out what would change, validating as it goes. Changes nothing."""
    if not ID_PATTERN.match(new):
        raise RenameError("The new id may use lowercase letters, digits and underscores only (2 to 41 characters).")
    if new in RESERVED:
        raise RenameError(f"'{new}' is reserved. Choose another id.")
    if old == new:
        raise RenameError("The old and new ids are the same.")

    tables = _tables(conn)
    if not conn.execute("SELECT 1 FROM institutions WHERE institution_id = ?", (old,)).fetchone():
        raise RenameError(f"No institution has the id '{old}'.")
    if conn.execute("SELECT 1 FROM institutions WHERE institution_id = ?", (new,)).fetchone():
        raise RenameError(f"An institution already uses the id '{new}'.")
    if "institution_aliases" in tables and conn.execute(
        "SELECT 1 FROM institution_aliases WHERE alias = ?", (new,)
    ).fetchone():
        raise RenameError(f"'{new}' is a former id of another institution.")
    if conn.execute(
        "SELECT 1 FROM institution_branding WHERE slug = ? AND institution_id != ?", (new, old)
    ).fetchone():
        raise RenameError(f"Another institution's URL is already '{new}'.")

    customers = sorted(_customer_ids(conn, tables, old))
    mapping = {u: new + u[len(old):] for u in customers}

    clash = [n for n in mapping.values() if any(
        conn.execute(f"SELECT 1 FROM {t} WHERE user_id = ? LIMIT 1", (n,)).fetchone()
        for t, cols in tables.items() if "user_id" in cols
    )]
    if clash:
        raise RenameError(f"Customer ids already exist under the new name: {', '.join(clash)}")

    changes: list[tuple[str, str, int]] = []
    for table, cols in tables.items():
        if "institution_id" in cols:
            n = conn.execute(f"SELECT COUNT(*) FROM {table} WHERE institution_id = ?", (old,)).fetchone()[0]
            if n:
                changes.append((table, "institution_id", n))
        if "user_id" in cols and mapping:
            marks = ",".join("?" for _ in mapping)
            n = conn.execute(f"SELECT COUNT(*) FROM {table} WHERE user_id IN ({marks})", list(mapping)).fetchone()[0]
            if n:
                changes.append((table, "user_id", n))
    if "audit_log" in tables:
        n = conn.execute("SELECT COUNT(*) FROM audit_log WHERE payload LIKE ?", (f'%"{old}"%',)).fetchone()[0]
        for u in mapping:
            n += conn.execute("SELECT COUNT(*) FROM audit_log WHERE payload LIKE ?", (f'%"{u}"%',)).fetchone()[0]
        if n:
            changes.append(("audit_log", "payload", n))

    return {"tables": tables, "mapping": mapping, "changes": changes}


def apply(conn: sqlite3.Connection, old: str, new: str, the_plan: dict) -> None:
    """Make the change inside the caller's transaction, then verify it."""
    tables, mapping = the_plan["tables"], the_plan["mapping"]
    before = _row_counts(conn, tables)

    for table, cols in tables.items():
        if "institution_id" in cols:
            conn.execute(f"UPDATE {table} SET institution_id = ? WHERE institution_id = ?", (new, old))
        if "user_id" in cols:
            for u, n in mapping.items():
                conn.execute(f"UPDATE {table} SET user_id = ? WHERE user_id = ?", (n, u))

    if "audit_log" in tables:
        conn.execute("UPDATE audit_log SET payload = REPLACE(payload, ?, ?) WHERE payload LIKE ?",
                     (f'"{old}"', f'"{new}"', f'%"{old}"%'))
        for u, n in mapping.items():
            conn.execute("UPDATE audit_log SET payload = REPLACE(payload, ?, ?) WHERE payload LIKE ?",
                         (f'"{u}"', f'"{n}"', f'%"{u}"%'))

    # Keep the old id working for old links, settings and open tabs.
    conn.execute("""CREATE TABLE IF NOT EXISTS institution_aliases (
        alias TEXT PRIMARY KEY, institution_id TEXT NOT NULL, created_at TEXT DEFAULT (datetime('now')))""")
    conn.execute("INSERT OR REPLACE INTO institution_aliases (alias, institution_id) VALUES (?, ?)", (old, new))
    # Anything that pointed at the old id as an alias now points at the new one.
    conn.execute("UPDATE institution_aliases SET institution_id = ? WHERE institution_id = ?", (new, old))

    # Verify. Any failure raises, and the caller rolls the whole thing back.
    tables_after = _tables(conn)
    after = _row_counts(conn, {t: c for t, c in tables_after.items() if t in before})
    if after != before:
        diff = {t: (before[t], after[t]) for t in before if before[t] != after.get(t)}
        raise RenameError(f"Row counts changed, which should never happen: {diff}")
    for table, cols in tables_after.items():
        if "institution_id" in cols and table != "institution_aliases":
            left = conn.execute(f"SELECT COUNT(*) FROM {table} WHERE institution_id = ?", (old,)).fetchone()[0]
            if left:
                raise RenameError(f"{left} row(s) in {table} still use the old id.")
        if "user_id" in cols and mapping:
            marks = ",".join("?" for _ in mapping)
            left = conn.execute(f"SELECT COUNT(*) FROM {table} WHERE user_id IN ({marks})", list(mapping)).fetchone()[0]
            if left:
                raise RenameError(f"{left} row(s) in {table} still use an old customer id.")
    if conn.execute("PRAGMA integrity_check").fetchone()[0] != "ok":
        raise RenameError("SQLite's integrity check failed after the change.")


def rename(conn: sqlite3.Connection, old: str, new: str, do_apply: bool) -> dict:
    """Plan and, if asked, apply a rename in a single transaction."""
    conn.isolation_level = None  # explicit transaction control
    conn.execute("BEGIN IMMEDIATE")
    try:
        the_plan = plan(conn, old, new)
        if do_apply:
            apply(conn, old, new, the_plan)
            conn.execute("COMMIT")
        else:
            conn.execute("ROLLBACK")
        return the_plan
    except Exception:
        conn.execute("ROLLBACK")
        raise


def main(argv: list[str]) -> int:
    args = [a for a in argv if not a.startswith("--")]
    do_apply = "--apply" in argv
    if len(args) != 2:
        print(__doc__)
        return 2

    old, new = args[0].strip().lower(), args[1].strip().lower()

    import config
    conn = sqlite3.connect(config.DB_PATH, timeout=30)
    print(f"Database: {config.DB_PATH}")
    try:
        result = rename(conn, old, new, do_apply)
    except RenameError as exc:
        print(f"\nNot changed. {exc}")
        return 1

    print(f"\n{'APPLIED' if do_apply else 'DRY RUN'}: {old} -> {new}")
    print("\nCustomer ids:")
    for u, n in result["mapping"].items():
        print(f"  {u}  ->  {n}")
    print("\nRows affected:")
    for table, column, n in result["changes"]:
        print(f"  {table:<22}{column:<16}{n}")

    if do_apply:
        print(f"\nDone. '{old}' still works as an alias for '{new}'.")
        print("Start the API again, then sign in to the console again.")
    else:
        print("\nNothing was changed. Run again with --apply to make the change.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
