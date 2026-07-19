"""Export the local SQLite database as Postgres-compatible SQL.

`sqlite3 .dump` is not usable here: it emits SQLite-flavoured DDL that
Postgres rejects (AUTOINCREMENT, integer booleans, datetime('now') defaults).
This walks the data instead and writes plain INSERTs, which load into a schema
Postgres has already created.

Usage:
    python api/scripts/export_db.py > fable_dump.sql
    psql "$DATABASE_URL" -f fable_dump.sql

Only data is exported. Create the schema first by booting the API against the
target database — it creates its own tables on startup.
"""
import os
import sqlite3
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from config import DB_PATH  # noqa: E402

# Order matters: nothing here has FK constraints today, but keeping parents
# first means the dump still loads if they are ever added.
TABLES = [
    "institutions",
    "institution_branding",
    "fable_users",
    "admins",
    "api_keys",
    "transactions",
    "ghost_containers",
    "device_profiles",
    "user_locations",
    "user_credentials",
    "audit_log",
]

# Passkeys are deliberately excluded from the default export: a credential is
# bound to the Relying Party ID it was registered against, so localhost
# credentials are invalid on a deployed domain and would only be dead rows.
SKIP_BY_DEFAULT = {"user_credentials"}


def literal(value) -> str:
    if value is None:
        return "NULL"
    if isinstance(value, (int, float)):
        return str(value)
    return "'" + str(value).replace("'", "''") + "'"


def export(include_credentials: bool = False) -> None:
    if not os.path.exists(DB_PATH):
        sys.exit(f"No database at {DB_PATH}")

    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row

    print("-- Fable data export (SQLite -> Postgres)")
    print("-- Load into a schema the API has already created.")
    print("BEGIN;")

    for table in TABLES:
        if table in SKIP_BY_DEFAULT and not include_credentials:
            print(f"-- skipped {table} (see module docstring)")
            continue
        try:
            rows = conn.execute(f"SELECT * FROM {table}").fetchall()
        except sqlite3.OperationalError:
            print(f"-- {table} not present in this database")
            continue
        if not rows:
            print(f"-- {table}: empty")
            continue

        columns = rows[0].keys()
        collist = ", ".join(f'"{c}"' for c in columns)
        print(f"\n-- {table}: {len(rows)} rows")
        for row in rows:
            values = ", ".join(literal(row[c]) for c in columns)
            # ON CONFLICT DO NOTHING so a partial re-run is safe.
            print(f"INSERT INTO {table} ({collist}) VALUES ({values}) ON CONFLICT DO NOTHING;")

    print("\nCOMMIT;")
    conn.close()


if __name__ == "__main__":
    export(include_credentials="--with-credentials" in sys.argv)
