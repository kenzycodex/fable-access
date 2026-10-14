"""Data that outlives a release: migrations, removals and the rules every row keeps."""
import os
import sqlite3
import sys
import tempfile

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
os.environ.setdefault("FABLE_DB_PATH", os.path.join(tempfile.mkdtemp(), "ids.db"))
os.environ.setdefault("FABLE_SESSION_SECRET", "test-secret")
os.environ.setdefault("SMTP_USERNAME", "")


def test_removing_institutions_keeps_only_the_named_one():
    from helpers import seed_bank

    from core import config
    from scripts import remove_institutions as rm

    for inst in ("keepbank", "dropbank", "dropbank2"):
        seed_bank(inst, days=20)
    conn = sqlite3.connect(config.DB_PATH, timeout=30)
    conn.execute("INSERT OR REPLACE INTO admins (email, institution_id, hashed_password) VALUES ('a@drop.ng', 'dropbank', 'x')")
    conn.execute("INSERT INTO transactions (id, user_id, amount, institution_id) VALUES ('orphan1', 'ghostbank_x', 5, 'ghostbank')")
    conn.commit()

    def kept(c):
        return (
            c.execute("SELECT COUNT(*) FROM transactions WHERE institution_id = 'keepbank'").fetchone()[0],
            c.execute("SELECT COUNT(*) FROM customers WHERE institution_id = 'keepbank'").fetchone()[0],
            c.execute("SELECT COUNT(*) FROM transaction_history WHERE institution_id = 'keepbank'").fetchone()[0],
            c.execute("SELECT COUNT(*) FROM accounts WHERE institution_id = 'keepbank'").fetchone()[0],
            c.execute("SELECT COUNT(*) FROM ghost_containers WHERE institution_id = 'keepbank'").fetchone()[0],
        )

    before = kept(conn)
    assert before[0] > 0

    dry = rm.remove(conn, ["keepbank"], do_apply=False)
    assert {"dropbank", "dropbank2", "ghostbank"} <= set(dry["institutions"])
    assert conn.execute("SELECT COUNT(*) FROM institutions WHERE institution_id = 'dropbank'").fetchone()[0] == 1

    rm.remove(conn, ["keepbank"], do_apply=True)
    assert [r[0] for r in conn.execute("SELECT institution_id FROM institutions WHERE institution_id IN ('keepbank','dropbank','dropbank2')")] == ["keepbank"]
    assert conn.execute("SELECT COUNT(*) FROM admins WHERE institution_id = 'dropbank'").fetchone()[0] == 0
    assert conn.execute("SELECT COUNT(*) FROM transactions WHERE institution_id IN ('dropbank','dropbank2','ghostbank')").fetchone()[0] == 0
    assert conn.execute("SELECT COUNT(*) FROM customers WHERE institution_id IN ('dropbank','dropbank2')").fetchone()[0] == 0
    assert kept(conn) == before

    with pytest.raises(rm.RemoveError):
        rm.remove(conn, ["does_not_exist"], do_apply=True)
    conn.close()


def test_an_empty_database_gets_no_default_institution():
    """Startup used to insert "Meridian MFB" into an empty database, so a
    deployment shipped with an institution nobody provisioned."""
    from core import db

    empty = sqlite3.connect(":memory:")
    empty.executescript(db.SCHEMA)
    db._migrate(empty)
    assert empty.execute("SELECT COUNT(*) FROM institutions").fetchone()[0] == 0
    assert empty.execute("SELECT COUNT(*) FROM admins").fetchone()[0] == 0
    assert empty.execute("SELECT COUNT(*) FROM api_keys").fetchone()[0] == 0


def test_a_table_created_with_the_old_default_is_rebuilt_without_it(tmp_path):
    """Databases created before the default tenant was removed carry
    `DEFAULT 'meridian'` in their schema. Startup rebuilds those tables without
    it, keeping every row and index."""
    from core import db

    conn = sqlite3.connect(tmp_path / "old.db")
    conn.executescript(db.SCHEMA)
    conn.execute("DROP TABLE fable_users")
    conn.execute(
        """CREATE TABLE fable_users (
            user_id TEXT PRIMARY KEY,
            institution_id TEXT DEFAULT 'meridian',
            enrolled_at TEXT DEFAULT (datetime('now')),
            copilot_enabled INTEGER DEFAULT 1,
            shield_enabled INTEGER DEFAULT 1,
            ghost_enabled INTEGER DEFAULT 1
        )"""
    )
    conn.execute("CREATE INDEX ix_old_users_inst ON fable_users (institution_id)")
    conn.execute("INSERT INTO fable_users (user_id, institution_id) VALUES ('ecobank_segun', 'ecobank')")
    conn.execute("INSERT INTO fable_users (user_id) VALUES ('orphan')")
    conn.commit()

    db._migrate(conn)

    sql = conn.execute("SELECT sql FROM sqlite_master WHERE name = 'fable_users'").fetchone()[0]
    assert "meridian" not in sql
    rows = dict(conn.execute("SELECT user_id, institution_id FROM fable_users").fetchall())
    assert rows == {"ecobank_segun": "ecobank", "orphan": "meridian"}  # data is never rewritten
    assert conn.execute("SELECT 1 FROM sqlite_master WHERE name = 'ix_old_users_inst'").fetchone()
    conn.execute("INSERT INTO fable_users (user_id) VALUES ('new')")
    assert conn.execute("SELECT institution_id FROM fable_users WHERE user_id = 'new'").fetchone()[0] is None

    db._migrate(conn)  # a second start is a no-op
    conn.close()


def test_rows_are_never_written_without_an_institution():
    from core.db import require_institution_id

    assert require_institution_id("ecobank") == "ecobank"
    for missing in (None, ""):
        with pytest.raises(ValueError):
            require_institution_id(missing)


def test_a_request_without_a_credential_names_no_institution():
    """There is no fallback bank any more, not even "the only one": a request
    without a credential is refused before any bank is chosen."""
    from fastapi import HTTPException
    from starlette.requests import Request

    from core.tenancy import caller_institution, register_institution

    register_institution("onlyone_x", "Only One", "a@x.ng")
    request = Request({"type": "http", "method": "GET", "path": "/", "headers": [], "query_string": b""})
    with pytest.raises(HTTPException) as err:
        caller_institution(request)
    assert err.value.status_code == 401


def test_clearing_an_institution_keeps_its_setup_and_other_banks(tmp_path):
    from helpers import seed_bank

    from core import config
    from core.db import cursor
    from scripts import clear_institution_data as clr

    seed_bank("clearbank", days=20)
    seed_bank("staybank", days=20)
    with cursor() as cur:
        cur.execute("INSERT OR REPLACE INTO admins (email, institution_id, hashed_password) VALUES ('o@clear.ng', 'clearbank', 'x')")
    conn = sqlite3.connect(config.DB_PATH, timeout=30, isolation_level=None)

    def count(table, inst):
        return conn.execute(f"SELECT COUNT(*) FROM {table} WHERE institution_id = ?", (inst,)).fetchone()[0]

    stay = {t: count(t, "staybank") for t in ("customers", "transactions", "transaction_history")}
    dry = clr.clear(conn, "clearbank", do_apply=False)
    assert dry["changes"] and count("customers", "clearbank") == 2

    clr.clear(conn, "clearbank", do_apply=True)
    for table in ("customers", "transactions", "transaction_history", "accounts", "ghost_containers"):
        assert count(table, "clearbank") == 0, table
    assert count("admins", "clearbank") == 1 and count("institutions", "clearbank") == 1
    assert {t: count(t, "staybank") for t in stay} == stay
    assert conn.execute("SELECT COUNT(*) FROM audit_log WHERE event_type = 'institution.data_cleared'").fetchone()[0] == 1
    with pytest.raises(clr.ClearError):
        clr.clear(conn, "nobank", do_apply=False)
    conn.close()
