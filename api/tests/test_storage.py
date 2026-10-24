"""An unwritable database is named once, plainly, and /health says so."""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))


def test_a_writable_database_has_no_problem(tmp_path):
    from core.storage import write_problem

    db = tmp_path / "fable.db"
    db.write_bytes(b"")
    assert write_problem(str(db)) is None


def test_an_unwritable_database_names_the_path_owner_and_uid(tmp_path, monkeypatch):
    from core import storage

    db = tmp_path / "fable.db"
    db.write_bytes(b"")
    # Tests may run as root, which can write anything; simulate the refusal.
    monkeypatch.setattr(storage.os, "access", lambda path, mode: not str(path).endswith("fable.db"))
    problem = storage.write_problem(str(db))
    assert problem and str(db) in problem and "owned by uid" in problem and "chown -R 10001:10001" in problem


def test_health_reports_an_unwritable_database(monkeypatch):
    from fastapi.testclient import TestClient

    from core import storage
    from main import app

    monkeypatch.setattr(storage, "write_problem", lambda path: "The database is not writable: test.")
    body = TestClient(app).get("/health")
    assert body.status_code == 503
    assert body.json()["database"] == {"healthy": False, "writable": False, "error": "The database is not writable: test."}
