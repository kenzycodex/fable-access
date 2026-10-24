"""The NIP response-code layer works through the API, and only for the bank's server.

The analyzer read context.nip_source and context.nip_response_code, but the
request model had neither field, so Pydantic dropped them and the layer (with
its NIP-34 forced block) could never fire for an API caller.
"""
import os
import sys
import tempfile

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
os.environ.setdefault("FABLE_DB_PATH", os.path.join(tempfile.mkdtemp(), "nip.db"))
os.environ.setdefault("FABLE_SESSION_SECRET", "test-secret")

BANK = "nipbank"


@pytest.fixture(scope="module")
def world():
    from fastapi.testclient import TestClient

    from core import apikeys, customers, sessions
    from core.db import cursor
    from core.tenancy import register_institution
    from main import app
    from services import accounts as ledger

    register_institution(BANK, "NIP Bank", "risk@nipbank.ng")
    raw = apikeys.generate()
    with cursor() as cur:
        apikeys.insert(cur, raw, BANK, "NIP Bank", "owner@nipbank.ng")
    c = customers.create(BANK, "nip-1", kind="test", source="console")
    ledger.ensure_account(c["id"], BANK, opening_balance=1_000_000)
    return {
        "client": TestClient(app),
        "key": {"X-API-Key": raw},
        "session": {"X-Fable-Session": sessions.issue("owner@nipbank.ng", BANK)["token"]},
    }


def _body(code: str | None, source: str | None = "rail", ref: str = "nip-1") -> dict:
    return {
        "user_id": ref,
        "transaction": {"amount": 2_000, "recipient_account": "0123456789", "channel": "branch"},
        "context": {"nip_source": source, "nip_response_code": code},
    }


def test_nip_34_from_the_banks_server_forces_a_block(world):
    res = world["client"].post("/v1/shield/analyze", json=_body("34"), headers=world["key"])
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["action"] == "BLOCK" and body["risk_score"] >= 0.95
    assert any(s.startswith("nip_34") for s in body["signals"])


def test_nip_63_adds_its_weight(world):
    body = world["client"].post("/v1/shield/analyze", json=_body("63"), headers=world["key"]).json()
    assert any(s.startswith("nip_63") for s in body["signals"])


def test_a_browser_session_cannot_report_a_nip_code(world):
    body = world["client"].post("/v1/shield/analyze", json=_body("34"), headers=world["session"]).json()
    assert not any(s.startswith("nip_") for s in body["signals"])
    assert body["action"] != "BLOCK" or body["risk_score"] < 0.95


def test_a_code_not_marked_as_from_the_rail_is_ignored(world):
    body = world["client"].post("/v1/shield/analyze", json=_body("34", source=None), headers=world["key"]).json()
    assert not any(s.startswith("nip_") for s in body["signals"])


def test_a_malformed_code_is_refused(world):
    res = world["client"].post("/v1/shield/analyze", json=_body("3; DROP"), headers=world["key"])
    assert res.status_code == 422
