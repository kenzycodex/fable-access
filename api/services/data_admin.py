"""Removing data, safely, from the console and the operator platform.

Three operations, each with a different owner because each carries a different
risk:

  * reset_sandbox: the bank's owner removes their test customers and everything
    those customers did. Real customers are never touched. Self-service, because
    test data carries no retention duty.
  * clear_institution: a Fable platform owner removes every customer and their
    activity, keeping the institution's setup. For a bank restarting with real
    data, on its documented instruction.
  * delete_institution: a Fable platform owner removes the institution entirely,
    after it has been suspended. Offboarding.

Banks have record-keeping duties under the CBN's AML/CFT rules and Fable acts on
their instructions as a processor under the NDPA, so real data is never deleted
by a bank member with one click. Each operation runs in one transaction,
verifies its result and the database's integrity before committing, and is
recorded in the audit log. export_institution produces the copy a bank should
keep before anything is removed.
"""
from __future__ import annotations

import csv
import io
import json
import sqlite3
import zipfile

from core import config

# What belongs to an institution's setup rather than its customers.
SETUP_TABLES = {
    "institutions", "admins", "api_keys", "institution_branding", "institution_settings", "webhooks",
    "webhook_deliveries", "audit_log", "institution_aliases", "password_resets", "operators",
    "operator_invites", "login_failures", "explanation_cache", "import_jobs", "import_rows",
    "platform_settings", "institution_assistant", "assistant_usage",
    "platform_secrets", "secret_changes", "secret_audit", "operator_passkeys", "operator_stepup",
}


class DataAdminError(Exception):
    """A reason the operation cannot safely go ahead."""


def _connect() -> sqlite3.Connection:
    conn = sqlite3.connect(config.DB_PATH, timeout=30, isolation_level=None)
    conn.row_factory = sqlite3.Row
    return conn


def _tables(conn) -> dict[str, list[str]]:
    names = [r[0] for r in conn.execute(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'")]
    return {t: [r[1] for r in conn.execute(f"PRAGMA table_info({t})")] for t in names}


def _marks(values) -> str:
    return ",".join("?" for _ in values)


def _other_counts(conn, tables, institution_id) -> dict[str, int]:
    return {t: conn.execute(f"SELECT COUNT(*) FROM {t} WHERE institution_id IS NOT NULL AND institution_id != ?",
                            (institution_id,)).fetchone()[0]
            for t, cols in tables.items() if "institution_id" in cols}


def _run(conn, work) -> dict:
    """Do `work` in one transaction, check integrity, commit or roll back."""
    try:
        conn.execute("BEGIN IMMEDIATE")
        result = work()
        if conn.execute("PRAGMA integrity_check").fetchone()[0] != "ok":
            raise DataAdminError("The database failed its integrity check. Nothing was changed.")
        conn.execute("COMMIT")
        return result
    except Exception:
        conn.execute("ROLLBACK")
        raise


def _delete_customers(conn, tables, institution_id, ids: list[str]) -> dict[str, int]:
    """Delete these customers and every row that is about them."""
    removed: dict[str, int] = {}
    if not ids:
        return removed
    for table, cols in tables.items():
        if table in SETUP_TABLES or "user_id" not in cols:
            continue
        where = f"user_id IN ({_marks(ids)})"
        args = list(ids)
        if "institution_id" in cols:
            where += " AND institution_id = ?"
            args.append(institution_id)
        n = conn.execute(f"DELETE FROM {table} WHERE {where}", args).rowcount
        if n:
            removed[table] = n
    n = conn.execute(f"DELETE FROM customers WHERE institution_id = ? AND id IN ({_marks(ids)})",
                     (institution_id, *ids)).rowcount
    if n:
        removed["customers"] = n
    return removed


def reset_sandbox(institution_id: str, actor: str) -> dict:
    """Remove the institution's test customers and everything they did."""
    conn = _connect()
    try:
        tables = _tables(conn)
        mode = conn.execute("SELECT mode FROM institutions WHERE institution_id = ?", (institution_id,)).fetchone()
        if not mode:
            raise DataAdminError("Institution not found.")
        ids = [r[0] for r in conn.execute(
            "SELECT id FROM customers WHERE institution_id = ? AND kind = 'test'", (institution_id,))]

        def work():
            before = _other_counts(conn, tables, institution_id)
            removed = _delete_customers(conn, tables, institution_id, ids)
            if _other_counts(conn, tables, institution_id) != before:
                raise DataAdminError("Another institution's data would change. Nothing was removed.")
            conn.execute(
                "INSERT INTO audit_log (user_id, institution_id, event_type, payload) VALUES (NULL, ?, ?, ?)",
                (institution_id, "sandbox.reset", json.dumps({"customers": len(ids), "rows": removed, "by": actor})),
            )
            return {"customers_removed": len(ids), "rows_removed": removed}

        return _run(conn, work)
    finally:
        conn.close()


def clear_institution(institution_id: str, actor: str, reason: str) -> dict:
    """Remove every customer and their activity; keep the institution's setup."""
    conn = _connect()
    try:
        tables = _tables(conn)
        if not conn.execute("SELECT 1 FROM institutions WHERE institution_id = ?", (institution_id,)).fetchone():
            raise DataAdminError("Institution not found.")
        ids = {r[0] for r in conn.execute("SELECT id FROM customers WHERE institution_id = ?", (institution_id,))}
        for table, cols in tables.items():
            if "user_id" in cols and "institution_id" in cols and table not in SETUP_TABLES:
                ids |= {r[0] for r in conn.execute(
                    f"SELECT DISTINCT user_id FROM {table} WHERE institution_id = ? AND user_id IS NOT NULL",
                    (institution_id,))}
        ids_list = sorted(ids)

        def work():
            before = _other_counts(conn, tables, institution_id)
            removed = _delete_customers(conn, tables, institution_id, ids_list)
            for table, cols in tables.items():
                if table in SETUP_TABLES or "institution_id" not in cols:
                    continue
                n = conn.execute(f"DELETE FROM {table} WHERE institution_id = ?", (institution_id,)).rowcount
                if n:
                    removed[table] = removed.get(table, 0) + n
            if _other_counts(conn, tables, institution_id) != before:
                raise DataAdminError("Another institution's data would change. Nothing was removed.")
            conn.execute(
                "INSERT INTO audit_log (user_id, institution_id, event_type, payload) VALUES (NULL, ?, ?, ?)",
                (institution_id, "institution.data_cleared",
                 json.dumps({"customers": len(ids_list), "rows": removed, "operator": actor, "reason": reason})),
            )
            return {"customers_removed": len(ids_list), "rows_removed": removed}

        return _run(conn, work)
    finally:
        conn.close()


def delete_institution(institution_id: str, actor: str, reason: str) -> dict:
    """Remove a suspended institution and everything that belongs to it."""
    conn = _connect()
    try:
        tables = _tables(conn)
        row = conn.execute("SELECT status FROM institutions WHERE institution_id = ?", (institution_id,)).fetchone()
        if not row:
            raise DataAdminError("Institution not found.")
        if (row["status"] or "active") != "suspended":
            raise DataAdminError("Suspend the institution before deleting it.")
        emails = [r[0] for r in conn.execute("SELECT email FROM admins WHERE institution_id = ?", (institution_id,))]

        def work():
            before = _other_counts(conn, tables, institution_id)
            cleared = clear_rows = 0
            ids = [r[0] for r in conn.execute("SELECT id FROM customers WHERE institution_id = ?", (institution_id,))]
            clear_rows += sum(_delete_customers(conn, tables, institution_id, ids).values())
            if emails and "password_resets" in tables:
                conn.execute(f"DELETE FROM password_resets WHERE email IN ({_marks(emails)})", emails)
            if "import_rows" in tables:
                conn.execute("DELETE FROM import_rows WHERE job_id IN (SELECT id FROM import_jobs WHERE institution_id = ?)",
                             (institution_id,))
            for table, cols in tables.items():
                if "institution_id" in cols and table != "audit_log":
                    cleared += conn.execute(f"DELETE FROM {table} WHERE institution_id = ?", (institution_id,)).rowcount
            if _other_counts(conn, tables, institution_id) != before:
                raise DataAdminError("Another institution's data would change. Nothing was removed.")
            # The audit trail of the institution is kept, closed by one last
            # entry, so the deletion itself can be shown to have happened.
            conn.execute(
                "INSERT INTO audit_log (user_id, institution_id, event_type, payload) VALUES (NULL, ?, ?, ?)",
                (institution_id, "institution.deleted", json.dumps({"operator": actor, "reason": reason})),
            )
            return {"rows_removed": cleared + clear_rows, "members_removed": len(emails)}

        return _run(conn, work)
    finally:
        conn.close()


def export_institution(institution_id: str) -> bytes:
    """A zip of CSVs: customers, decisions, imported history, holds, audit log."""
    conn = _connect()
    try:
        out = io.BytesIO()
        with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED) as z:
            for table in ("customers", "transactions", "transaction_history", "ghost_containers", "audit_log", "case_notes"):
                cols = [r[1] for r in conn.execute(f"PRAGMA table_info({table})")]
                if "institution_id" not in cols:
                    continue
                buf = io.StringIO()
                writer = csv.writer(buf)
                writer.writerow(cols)
                for row in conn.execute(f"SELECT * FROM {table} WHERE institution_id = ?", (institution_id,)):
                    writer.writerow([_safe(v) for v in row])
                z.writestr(f"{table}.csv", buf.getvalue())
        return out.getvalue()
    finally:
        conn.close()


def _safe(value):
    """Neutralise spreadsheet formulas in exported text."""
    if isinstance(value, str) and value[:1] in ("=", "+", "-", "@"):
        return "'" + value
    return value
