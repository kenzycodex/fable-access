"""Importing a bank's customers and history.

The promises: bad rows are reported by line and field and never applied; a
reference already imported is skipped, never doubled; imported history forms
customers' baselines but never counts as a Shield decision; and one bank can
neither see nor apply another bank's import.
"""
import os
import sys
import tempfile
import time
from datetime import timedelta

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
os.environ.setdefault("FABLE_DB_PATH", os.path.join(tempfile.mkdtemp(), "imports.db"))
os.environ.setdefault("FABLE_SESSION_SECRET", "test-secret")
os.environ.setdefault("SMTP_USERNAME", "")

BANK, OTHER = "importbank", "importother"


def _session(inst: str, role: str = "owner") -> dict:
    from core import sessions
    from core.db import cursor
    from core.utils import hash_password

    email = f"{role}@{inst}.ng"
    with cursor() as cur:
        cur.execute(
            "INSERT OR REPLACE INTO admins (email, institution_id, hashed_password, role, name, active) VALUES (?, ?, ?, ?, ?, 1)",
            (email, inst, hash_password("correct-horse-1"), role, role),
        )
    return {"X-Fable-Session": sessions.issue(email, inst)["token"]}


@pytest.fixture(scope="module")
def client():
    from fastapi.testclient import TestClient

    from core.tenancy import register_institution
    from main import app

    register_institution(BANK, "Import Bank", "risk@importbank.ng")
    register_institution(OTHER, "Other Bank", "risk@importother.ng")
    return TestClient(app)


def _csv(header: str, *rows: str) -> bytes:
    return ("\n".join([header, *rows]) + "\n").encode()


def _upload(client, kind, raw, headers):
    return client.post(f"/v1/imports/{kind}/csv", headers=headers, files={"file": ("data.csv", raw, "text/csv")})


def _apply(client, job_id, headers) -> dict:
    assert client.post(f"/v1/imports/{job_id}/apply", headers=headers).status_code == 200
    for _ in range(100):
        job = client.get(f"/v1/imports/{job_id}", headers=headers).json()
        if job["status"] in ("completed", "failed"):
            return job
        time.sleep(0.05)
    raise AssertionError("import did not finish")


def _iso(days_ago: int, hour: int = 10) -> str:
    from core.utils import utcnow

    when = (utcnow() - timedelta(days=days_ago)).replace(hour=hour, minute=15, second=0, microsecond=0)
    return when.isoformat() + "+01:00"


def test_customers_csv_is_validated_then_applied_once(client):
    owner = _session(BANK)
    raw = _csv(
        "reference,name,phone,email,segment,kind,opening_balance",
        "CIF-1,Ada Obi,+2348030000000,ada@example.com,Salaried,real,",
        "CIF-2,Tunde Bello,,,Trader,real,",
        "bad ref!,Nobody,,,,real,",
        "CIF-3,Bad Email,,not-an-email,,real,",
        "CIF-1,Duplicate,,,,real,",
        "TEST-1,Test Customer,,,,test,250000",
    )
    job = _upload(client, "customers", raw, owner).json()
    assert job["status"] == "validated"
    assert job["total"] == 6 and job["valid"] == 3 and job["invalid"] == 3
    assert {(e["line"], e["field"]) for e in job["errors"]} == {(4, "reference"), (5, "email"), (6, "reference")}

    done = _apply(client, job["id"], owner)
    assert done["status"] == "completed" and done["inserted"] == 3

    # The same file again changes nothing: every reference is already there.
    again = _apply(client, _upload(client, "customers", raw, owner).json()["id"], owner)
    assert again["inserted"] == 0 and again["skipped"] == 3

    # The test customer starts with the sandbox balance it was given.
    test = client.get("/v1/customers/TEST-1", headers=owner).json()
    assert test["kind"] == "test"
    assert client.get("/v1/accounts/TEST-1", headers=owner).json()["available"] == 250000


def test_history_forms_a_baseline_but_is_not_a_decision(client):
    from agents.copilot.baseline import get_user_baseline
    from core import customers

    owner = _session(BANK)
    # A customer of its own, so the customers import test can run before or after.
    customers.ensure(BANK, "CIF-HIST", kind="real", source="console")
    stats_before = client.get("/v1/dashboard/stats", headers=owner).json()
    rows = [f"CIF-HIST,TRF-H{i},{20000 + i * 500},{_iso(5 + i)},0123456789,058,MUSA ADEOLA,mobile_app,completed,,Lagos,Nigeria"
            for i in range(6)]
    rows.append(f"NOBODY,TRF-HX,1000,{_iso(3)},0123456789,,,,completed,,,")
    rows.append(f"CIF-HIST,TRF-HFUTURE,1000,{_iso(-2)},0123456789,,,,completed,,,")
    raw = _csv("customer_reference,reference,amount,occurred_at,recipient_account,recipient_bank,recipient_name,"
               "channel,outcome,device_id,city,country", *rows)
    job = _upload(client, "transactions", raw, owner).json()
    assert job["valid"] == 7 and job["invalid"] == 1  # the future date fails validation
    done = _apply(client, job["id"], owner)
    assert done["inserted"] == 6
    assert any(e["field"] == "customer_reference" for e in done["errors"])  # unknown customer, at apply time

    ada = customers.get(BANK, "CIF-HIST")
    baseline = get_user_baseline(ada["id"])
    assert baseline and baseline["transaction_count"] == 6
    assert "0123456789" in baseline["known_recipients"]
    assert 10 in baseline["typical_hours"]  # the customer's local hour, as sent

    # Not a decision: the console's decision figures are unchanged.
    stats_after = client.get("/v1/dashboard/stats", headers=owner).json()
    assert stats_after["transactions_analyzed"] == stats_before["transactions_analyzed"]
    listed = client.get("/v1/dashboard/transactions", headers=owner).json()
    assert all(t["user_id"] != ada["id"] for t in listed.get("transactions", []))


def test_json_batch_with_the_api_key_is_idempotent(client):
    from core import apikeys
    from core.db import cursor

    key = apikeys.generate()
    with cursor() as cur:
        apikeys.insert(cur, key, BANK, "Import Bank", "owner@importbank.ng")
    headers = {"X-API-Key": key}
    body = {"rows": [{"reference": "API-1", "name": "Api Person"}, {"reference": "API-2"}]}
    first = client.post("/v1/imports/customers", json=body, headers=headers).json()
    assert first["inserted"] == 2 and first["skipped"] == 0
    second = client.post("/v1/imports/customers", json=body, headers=headers).json()
    assert second["inserted"] == 0 and second["skipped"] == 2

    txns = {"rows": [{"customer_reference": "API-1", "reference": "API-T1", "amount": 5000,
                      "occurred_at": _iso(2), "recipient_account": "0987654321"}]}
    assert client.post("/v1/imports/transactions", json=txns, headers=headers).json()["inserted"] == 1
    assert client.post("/v1/imports/transactions", json=txns, headers=headers).json()["skipped"] == 1


def test_only_owners_import_and_banks_stay_apart(client):
    owner, analyst, stranger = _session(BANK), _session(BANK, "analyst"), _session(OTHER)
    raw = _csv("reference,name", "CIF-9,Nine")
    assert _upload(client, "customers", raw, analyst).status_code == 403
    assert client.post("/v1/imports/customers", json={"rows": [{"reference": "X"}]}).status_code == 401

    job = _upload(client, "customers", raw, owner).json()
    assert client.get(f"/v1/imports/{job['id']}", headers=stranger).status_code == 404
    assert client.post(f"/v1/imports/{job['id']}/apply", headers=stranger).status_code == 409
    assert client.delete(f"/v1/imports/{job['id']}", headers=owner).json()["status"] == "discarded"
    assert all(j["id"] != job["id"] for j in client.get("/v1/imports", headers=stranger).json()["imports"])


def test_a_file_that_cannot_be_read_is_refused_whole(client):
    owner = _session(BANK)
    assert _upload(client, "customers", b"name,phone\nAda,123\n", owner).status_code == 400  # no reference column
    assert _upload(client, "customers", b"reference\n", owner).status_code == 400  # header only
    assert _upload(client, "transactions", "reference\n\xff".encode("latin-1"), owner).status_code == 400
    assert client.get("/v1/imports/templates/customers.csv", headers=owner).text.startswith("reference,")


def test_customers_can_be_added_and_edited_by_hand(client):
    owner, viewer, stranger = _session(BANK), _session(BANK, "viewer"), _session(OTHER)
    made = client.post("/v1/customers", json={"reference": "HAND-1", "name": "By Hand", "opening_balance": 1000},
                       headers=owner)
    assert made.status_code == 201 and made.json()["kind"] == "test"  # a sandbox bank adds test customers
    assert client.post("/v1/customers", json={"reference": "HAND-1"}, headers=owner).status_code == 409
    assert client.post("/v1/customers", json={"reference": "HAND-2"}, headers=viewer).status_code == 403
    assert client.post("/v1/customers", json={"reference": "HAND-3", "kind": "real", "opening_balance": 5},
                       headers=owner).status_code == 400  # a real customer has no Fable balance

    edited = client.patch("/v1/customers/HAND-1", json={"name": "Renamed", "status": "closed"}, headers=owner).json()
    assert edited["name"] == "Renamed" and edited["status"] == "closed"
    assert client.patch("/v1/customers/HAND-1", json={"name": "Hijack"}, headers=stranger).status_code == 404
