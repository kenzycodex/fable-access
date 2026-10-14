"""Customer ids follow the customer's name, and existing data moves to them safely."""
import os
import sqlite3
import sys
import tempfile

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
os.environ.setdefault("FABLE_DB_PATH", os.path.join(tempfile.mkdtemp(), "ids.db"))
os.environ.setdefault("FABLE_SESSION_SECRET", "test-secret")
os.environ.setdefault("SMTP_USERNAME", "")


def test_id_is_the_institution_plus_the_first_name():
    from agents.copilot.demo_customers import customer_identity, user_id_for

    for key in ("ada", "tunde", "chioma"):
        name, _ = customer_identity("ecobank", key)
        assert user_id_for("ecobank", key) == f"ecobank_{name.split()[0].lower()}"


def test_ids_never_collide_within_an_institution():
    from agents.copilot.demo_customers import DEMO_CUSTOMERS, user_id_for

    for inst in ("ecobank", "meridian", "zenith_test_bank", "a", "b", "c", "d", "e", "f"):
        ids = [user_id_for(inst, c["key"]) for c in DEMO_CUSTOMERS]
        assert len(set(ids)) == len(ids)


def test_names_resolve_for_both_the_new_and_the_old_format():
    from agents.copilot.demo_customers import customer_identity, customer_name_for, legacy_user_id_for, user_id_for

    name, _ = customer_identity("ecobank", "chioma")
    assert customer_name_for(user_id_for("ecobank", "chioma")) == name
    assert customer_name_for(legacy_user_id_for("ecobank", "chioma")) == name
    # A real integrator's id is never given an invented name.
    assert customer_name_for("ecobank_cust_10293") is None
    assert customer_name_for("ecobank_someoneelse") is None


@pytest.fixture()
def legacy_bank():
    """An institution whose customers still carry the old archetype ids."""
    from agents.copilot.demo_customers import DEMO_CUSTOMERS, legacy_user_id_for, seed_institution, user_id_for
    from core import config
    from core.tenancy import register_institution
    from scripts.rename_institution import _tables

    inst = "legacybank"
    register_institution(inst, "Legacy Bank", "risk@legacy.ng")
    seed_institution(inst, days=30)

    conn = sqlite3.connect(config.DB_PATH, timeout=30)
    tables = _tables(conn)
    for c in DEMO_CUSTOMERS:
        new, old = user_id_for(inst, c["key"]), legacy_user_id_for(inst, c["key"])
        for t, cols in tables.items():
            if "user_id" in cols:
                conn.execute(f"UPDATE {t} SET user_id = ? WHERE user_id = ?", (old, new))
    # A real integrator's customer at the same bank, which must be left alone.
    conn.execute("INSERT OR IGNORE INTO fable_users (user_id, institution_id) VALUES (?, ?)", (f"{inst}_cust_1", inst))
    conn.commit()
    yield conn, inst
    conn.close()


def _counts(conn):
    return {t: conn.execute(f"SELECT COUNT(*) FROM {t}").fetchone()[0]
            for (t,) in conn.execute("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'")
            if t != "user_aliases"}


def test_migration_moves_history_and_is_safe(legacy_bank):
    from agents.copilot.demo_customers import legacy_user_id_for, user_id_for
    from scripts import rename_customers as rc

    conn, inst = legacy_bank
    old, new = legacy_user_id_for(inst, "tunde"), user_id_for(inst, "tunde")
    before = _counts(conn)
    txns = conn.execute("SELECT COUNT(*) FROM transactions WHERE user_id = ?", (old,)).fetchone()[0]
    assert txns > 0

    # A dry run reports the change and makes none.
    dry = rc.rename(conn, [inst], do_apply=False)
    assert dry["mapping"][old] == new
    assert conn.execute("SELECT COUNT(*) FROM transactions WHERE user_id = ?", (old,)).fetchone()[0] == txns

    rc.rename(conn, [inst], do_apply=True)
    assert conn.execute("SELECT COUNT(*) FROM transactions WHERE user_id = ?", (new,)).fetchone()[0] == txns
    for t, cols in rc._tables(conn).items():
        if "user_id" in cols and t != "user_aliases":
            assert conn.execute(f"SELECT COUNT(*) FROM {t} WHERE user_id = ?", (old,)).fetchone()[0] == 0
    assert _counts(conn) == before  # no row gained or lost
    assert conn.execute("SELECT user_id FROM user_aliases WHERE alias = ?", (old,)).fetchone()[0] == new

    # The integrator's customer is untouched, and a second run changes nothing.
    assert conn.execute("SELECT 1 FROM fable_users WHERE user_id = ?", (f"{inst}_cust_1",)).fetchone()
    assert rc.rename(conn, [inst], do_apply=True)["mapping"] == {}


def test_migration_refuses_to_overwrite_an_existing_id(legacy_bank):
    from agents.copilot.demo_customers import user_id_for
    from scripts import rename_customers as rc

    conn, inst = legacy_bank
    conn.execute("INSERT OR IGNORE INTO fable_users (user_id, institution_id) VALUES (?, ?)", (user_id_for(inst, "tunde"), inst))
    conn.commit()
    before = _counts(conn)
    with pytest.raises(rc.RenameError):
        rc.rename(conn, [inst], do_apply=True)
    assert _counts(conn) == before


def test_removing_institutions_keeps_only_the_named_one():
    from agents.copilot.demo_customers import seed_institution
    from core import config
    from core.tenancy import register_institution
    from scripts import remove_institutions as rm

    for inst in ("keepbank", "dropbank", "dropbank2"):
        register_institution(inst, inst.title(), f"risk@{inst}.ng")
        seed_institution(inst, days=20)
    conn = sqlite3.connect(config.DB_PATH, timeout=30)
    conn.execute("INSERT OR REPLACE INTO admins (email, institution_id, hashed_password) VALUES ('a@drop.ng', 'dropbank', 'x')")
    conn.execute("INSERT INTO transactions (id, user_id, amount, institution_id) VALUES ('orphan1', 'ghostbank_x', 5, 'ghostbank')")
    conn.commit()

    def kept(c):
        return (
            c.execute("SELECT COUNT(*) FROM transactions WHERE institution_id = 'keepbank'").fetchone()[0],
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
    assert conn.execute("SELECT COUNT(*) FROM fable_users WHERE institution_id IN ('dropbank','dropbank2')").fetchone()[0] == 0
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
