"""Every error has the same shape: detail (as before), error and message."""
import os
import sys
import tempfile

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
os.environ.setdefault("FABLE_DB_PATH", os.path.join(tempfile.mkdtemp(), "errors.db"))
os.environ.setdefault("FABLE_SESSION_SECRET", "test-secret")


@pytest.fixture(scope="module")
def client():
    from fastapi.testclient import TestClient

    from core.tenancy import register_institution
    from main import app

    register_institution("errorbank", "Error Bank", "risk@error.ng")
    return TestClient(app)


def _session() -> dict:
    from core import sessions

    return {"X-Fable-Session": sessions.issue("owner@error.ng", "errorbank")["token"]}


def test_a_route_error_keeps_detail_and_adds_a_code(client):
    res = client.get("/v1/customers/nobody", headers=_session())
    assert res.status_code == 404
    assert res.json() == {"detail": "Customer not found.", "error": "not_found", "message": "Customer not found."}


def test_a_structured_detail_keeps_its_own_code(client):
    from fastapi import HTTPException

    from core.errors import body

    assert body(409, {"error": "container_expired", "message": "Gone."})["error"] == "container_expired"
    assert isinstance(HTTPException, type)


def test_an_invalid_body_says_which_field(client):
    res = client.post("/v1/customers", headers=_session(), json={"reference": ""})
    assert res.status_code == 422
    data = res.json()
    assert data["error"] == "invalid_request" and "reference" in data["message"] and isinstance(data["detail"], list)


def test_the_middleware_errors_have_the_same_shape(client):
    res = client.post("/v1/shield/analyze", json={})
    assert res.status_code == 401 and res.json()["error"] == "unauthorized" and res.json()["detail"]
