"""Exercises the endpoints, not just the scoring functions.

`test_scoring.py` calls functions directly, which is why a NameError inside a
route handler shipped: `pin_verify` returned a `level` variable that had been
deleted with the dead ternary that defined it. Nothing imported the module in a
way that ran that line, so it only failed in a browser, mid-verification, as a
bare 500.

These tests drive the real ASGI app, so every route body actually executes.
"""
import os
import sys
import tempfile

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
os.environ.setdefault("FABLE_DB_PATH", os.path.join(tempfile.mkdtemp(), "endpoints.db"))
os.environ.setdefault("FABLE_SESSION_SECRET", "test-secret")
os.environ.setdefault("FABLE_OPERATOR_KEY", "test-operator-key")
os.environ.setdefault("SMTP_USERNAME", "")

USER = "endpointbank_chioma"
PIN = "8317"


@pytest.fixture(scope="module")
def client():
    from fastapi.testclient import TestClient
    from main import app
    from tenancy import register_institution
    from agents.copilot.demo_customers import seed_institution

    register_institution("endpointbank", "Endpoint Bank", "risk@endpoint.ng")
    seed_institution("endpointbank", days=90)
    with TestClient(app) as c:
        yield c


def test_health_reports_what_can_be_silently_wrong(client):
    body = client.get("/health").json()
    assert body["status"] == "ok"
    assert body["missing_required_routers"] == []
    assert body["pattern_library"]["healthy"] is True


def test_pin_can_be_set_and_then_verified(client):
    """The regression. `pin_verify` referenced an undefined `level` and returned
    a 500 to a customer part-way through confirming a flagged transfer."""
    setup = client.post(f"/v1/accounts/{USER}/security/pin", json={"pin": PIN})
    assert setup.status_code == 200, setup.text

    res = client.post("/v1/stepup/pin/verify", json={
        "user_id": USER, "pin": PIN, "purpose": "transfer", "reference": "txn_test",
    })
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["verified"] is True
    assert body["level"] == "pin"
    assert body["token"]


def test_wrong_pin_is_a_400_not_a_500(client):
    res = client.post("/v1/stepup/pin/verify", json={
        "user_id": USER, "pin": "0000", "purpose": "transfer", "reference": "txn_test",
    })
    assert res.status_code == 400


def test_stepup_requirement_resolves_for_every_tier(client):
    """Each branch of required_level(), so none of them can carry a NameError."""
    for score, action in ((0.2, "PASS"), (0.6, "FLAG"), (0.9, "BLOCK")):
        res = client.post("/v1/stepup/requirement", json={
            "user_id": USER, "risk_score": score, "action": action,
            "signals": ["device_anomaly: x", "location_anomaly: y"],
            "purpose": "transfer",
        })
        assert res.status_code == 200, res.text
        assert res.json()["level"]

    res = client.post("/v1/stepup/requirement", json={
        "user_id": USER, "risk_score": 0.9, "action": "BLOCK", "purpose": "ghost_release",
    })
    assert res.json()["level"] == "identity_check"


def test_otp_never_returns_the_code(client):
    """SEC-1. debug_code was attached whenever delivery failed, and with no SMS
    provider wired delivery fails by default."""
    client.post(f"/v1/accounts/{USER}/security/contact",
                json={"email": "c@example.com", "current_pin": PIN})
    res = client.post("/v1/stepup/otp/send", json={
        "user_id": USER, "purpose": "transfer", "reference": "txn_test",
    })
    assert "debug_code" not in res.text


def test_scoring_endpoint_returns_a_decision(client):
    res = client.post("/v1/shield/analyze", json={
        "user_id": USER,
        "transaction": {"amount": 4000, "recipient_account": "0123456789",
                        "narration": "food", "channel": "mobile_app"},
        "institution_id": "endpointbank",
    })
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["action"] in {"PASS", "FLAG", "BLOCK"}
    assert body["transaction_id"]


def test_negative_amount_is_rejected_at_the_edge(client):
    res = client.post("/v1/shield/analyze", json={
        "user_id": USER,
        "transaction": {"amount": -5000, "recipient_account": "0123456789"},
    })
    assert res.status_code == 422


def test_credentials_and_provisioning_stay_gated(client):
    assert client.get("/v1/institutions/endpointbank/credentials").status_code == 401
    assert client.post("/admin/provision", json={
        "institution_name": "Sneaky", "admin_email": "a@b.c",
    }).status_code == 401


def test_tenant_cannot_be_switched_by_query_parameter(client):
    """S0-4. Reads took their tenant from an unbound query parameter, and
    omitting it aggregated every institution together."""
    import sessions

    token = sessions.issue("risk@endpoint.ng", "endpointbank")["token"]
    res = client.get("/v1/agents/overview?institution=some_other_bank",
                     headers={"X-Fable-Session": token})
    assert res.status_code == 200
    assert client.get("/v1/agents/overview").status_code == 401
