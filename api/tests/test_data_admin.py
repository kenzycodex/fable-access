"""Removing data: who may, what goes, and what never does.

A bank's owner can reset its sandbox (test customers only). Clearing real
customers and deleting an institution are a Fable platform owner's actions,
with a typed confirmation and a reason, and deleting needs a suspension first.
Other institutions are never touched, and the audit trail survives.
"""
import os
import sys
import tempfile

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
os.environ.setdefault("FABLE_DB_PATH", os.path.join(tempfile.mkdtemp(), "data_admin.db"))
os.environ.setdefault("FABLE_SESSION_SECRET", "test-secret")
os.environ.setdefault("SMTP_USERNAME", "")


def _console(inst: str, role: str = "owner") -> dict:
    from core import sessions
    from core.db import cursor

    email = f"{role}@{inst}.ng"
    with cursor() as cur:
        cur.execute(
            "INSERT OR REPLACE INTO admins (email, institution_id, hashed_password, role, active) VALUES (?, ?, 'x', ?, 1)",
            (email, inst, role),
        )
    return {"X-Fable-Session": sessions.issue(email, inst)["token"]}


def _operator(role: str) -> dict:
    from core import operators
    from core.db import cursor
    from scripts.create_operator import create

    email = f"{role}@fable.test"
    create(email, role, role, "a-long-test-password")
    with cursor() as cur:
        cur.execute("UPDATE operators SET totp_enabled = 1 WHERE email = ?", (email,))
    return {"X-Fable-Operator": operators.issue_session(email, operators.get(email)["session_version"])["token"]}


def _count(table: str, inst: str) -> int:
    from core.db import cursor

    with cursor() as cur:
        cur.execute(f"SELECT COUNT(*) FROM {table} WHERE institution_id = ?", (inst,))
        return cur.fetchone()[0]


@pytest.fixture(scope="module")
def client():
    from fastapi.testclient import TestClient

    from main import app

    return TestClient(app)


def test_owner_resets_only_the_sandbox_test_customers(client):
    from helpers import seed_bank

    from core import customers

    seed_bank("resetbank", days=20)
    customers.create("resetbank", "REAL-1", kind="real", source="api", display_name="Real")
    seed_bank("neighbour", days=20)
    neighbour = {t: _count(t, "neighbour") for t in ("customers", "transactions", "transaction_history")}

    owner, analyst = _console("resetbank"), _console("resetbank", "analyst")
    assert client.post("/v1/sandbox/reset", json={"confirm": "resetbank"}, headers=analyst).status_code == 403
    assert client.post("/v1/sandbox/reset", json={"confirm": "wrong"}, headers=owner).status_code == 400
    done = client.post("/v1/sandbox/reset", json={"confirm": "resetbank"}, headers=owner).json()
    assert done["customers_removed"] == 2
    assert {c["external_ref"] for c in customers.listing("resetbank")[0]} == {"REAL-1"}
    assert _count("transactions", "resetbank") == 0 and _count("transaction_history", "resetbank") == 0
    assert {t: _count(t, "neighbour") for t in neighbour} == neighbour


def test_platform_owner_clears_a_bank_after_confirming(client):
    from helpers import seed_bank

    seed_bank("clearme", days=20)
    _console("clearme")
    admin, owner = _operator("platform_admin"), _operator("platform_owner")
    body = {"confirm": "clearme", "reason": "Restarting with real data"}

    export = client.get("/operator/institutions/clearme/export.zip", headers=admin)
    assert export.status_code == 200 and export.content[:2] == b"PK"

    assert client.post("/operator/institutions/clearme/clear-data", json=body, headers=admin).status_code == 403
    assert client.post("/operator/institutions/clearme/clear-data", json={**body, "confirm": "x"}, headers=owner).status_code == 400
    assert client.post("/operator/institutions/clearme/clear-data", json=body, headers=owner).status_code == 200
    assert _count("customers", "clearme") == 0 and _count("transactions", "clearme") == 0
    assert _count("admins", "clearme") == 1 and _count("institutions", "clearme") == 1


def test_deleting_needs_a_suspension_and_keeps_the_audit_trail(client):
    from helpers import seed_bank

    seed_bank("goodbye", days=10)
    _console("goodbye")
    owner = _operator("platform_owner")
    body = {"confirm": "goodbye", "reason": "Contract ended"}
    assert client.post("/operator/institutions/goodbye/delete", json=body, headers=owner).status_code == 409
    client.post("/operator/institutions/goodbye/suspend", json={"reason": "Contract ended"}, headers=owner)
    assert client.post("/operator/institutions/goodbye/delete", json=body, headers=owner).status_code == 200
    for table in ("institutions", "admins", "customers", "transactions", "transaction_history", "api_keys"):
        assert _count(table, "goodbye") == 0, table
    assert _count("audit_log", "goodbye") >= 1
