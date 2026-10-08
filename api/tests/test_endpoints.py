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


# ---------------------------------------------------------------------------
# PIN choice and recovery
# ---------------------------------------------------------------------------

def test_any_pin_of_the_right_length_is_accepted(client):
    """By default there are no strength rules: a customer may pick 1234 or 0000.
    The protection is the lock-out on repeated wrong attempts."""
    user = "endpointbank_tunde"
    last = None
    for pin in ("1234", "0000", "1111"):
        res = client.post(f"/v1/accounts/{user}/security/pin", json={"pin": pin, "current_pin": last})
        assert res.status_code == 200, (pin, res.text)
        last = pin


def test_pin_must_be_digits_and_exactly_the_configured_length(client):
    user = "endpointbank_ada"
    assert client.post(f"/v1/accounts/{user}/security/pin", json={"pin": "12ab"}).status_code == 400
    assert client.post(f"/v1/accounts/{user}/security/pin", json={"pin": "12345"}).status_code == 400
    # The default length is 4, so a 6-digit PIN is refused too.
    assert client.post(f"/v1/accounts/{user}/security/pin", json={"pin": "123456"}).status_code == 400


def test_pin_rules_come_from_the_environment_not_the_code(client, monkeypatch):
    """Length, weak-PIN blocking and the lock-out are operator choices."""
    import config

    user = "endpointbank_rules"

    monkeypatch.setattr(config, "PIN_LENGTH", 6)
    assert client.post(f"/v1/accounts/{user}/security/pin", json={"pin": "4821"}).status_code == 400
    ok = client.post(f"/v1/accounts/{user}/security/pin", json={"pin": "482193"})
    assert ok.status_code == 200
    assert ok.json()["pin_length"] == 6          # boxes match the PIN that was set

    monkeypatch.setattr(config, "PIN_LENGTH", 4)
    monkeypatch.setattr(config, "PIN_BLOCK_WEAK", True)
    other = "endpointbank_weak"
    for weak in ("0000", "1234", "9876"):
        assert client.post(f"/v1/accounts/{other}/security/pin", json={"pin": weak}).status_code == 400, weak
    assert client.post(f"/v1/accounts/{other}/security/pin", json={"pin": "4821"}).status_code == 200

    # Lock-out after a configured number of wrong attempts.
    monkeypatch.setattr(config, "PIN_MAX_ATTEMPTS", 2)
    for _ in range(2):
        client.post("/v1/stepup/pin/verify", json={"user_id": other, "pin": "1111", "purpose": "transfer"})
    locked = client.post("/v1/stepup/pin/verify", json={"user_id": other, "pin": "4821", "purpose": "transfer"})
    assert locked.status_code == 400 and "Too many" in locked.json()["detail"]


def test_institution_can_clear_its_own_customers_pin_only(client):
    import security
    import sessions

    user = "endpointbank_chioma"
    client.post(f"/v1/accounts/{user}/security/pin", json={"pin": "9999"}) if not security.status(user)["pin_set"] else None
    assert security.status(user)["pin_set"] is True

    url = f"/v1/institutions/endpointbank/customers/{user}/pin/reset"
    assert client.post(url).status_code == 401  # no session

    other = sessions.issue("risk@other.ng", "someotherbank")["token"]
    assert client.post(url, headers={"X-Fable-Session": other}).status_code == 404

    own = sessions.issue("risk@endpoint.ng", "endpointbank")["token"]
    res = client.post(url, headers={"X-Fable-Session": own})
    assert res.status_code == 200
    assert res.json()["pin_set"] is False

    stranger = client.post("/v1/institutions/endpointbank/customers/nobody_here/pin/reset",
                           headers={"X-Fable-Session": own})
    assert stranger.status_code == 404


# ---------------------------------------------------------------------------
# Institution profile
# ---------------------------------------------------------------------------

def test_institution_can_edit_its_own_profile_only(client):
    import sessions

    url = "/v1/institutions/endpointbank"
    assert client.patch(url, json={"name": "New Name"}).status_code == 401

    other = sessions.issue("risk@other.ng", "someotherbank")["token"]
    assert client.patch(url, json={"name": "Hijack"}, headers={"X-Fable-Session": other}).status_code == 404

    own = {"X-Fable-Session": sessions.issue("risk@endpoint.ng", "endpointbank")["token"]}
    res = client.patch(url, json={"name": "  Endpoint   Bank Plc ", "type": "Commercial Bank",
                                  "contact_email": "Ops@Endpoint.ng"}, headers=own)
    assert res.status_code == 200
    body = res.json()
    assert body["name"] == "Endpoint Bank Plc"          # whitespace tidied
    assert body["type"] == "Commercial Bank"
    assert body["contact_email"] == "ops@endpoint.ng"   # lower-cased
    assert body["institution_id"] == "endpointbank"     # the tenant key never moves


def test_institution_profile_rejects_bad_input(client):
    import sessions

    own = {"X-Fable-Session": sessions.issue("risk@endpoint.ng", "endpointbank")["token"]}
    url = "/v1/institutions/endpointbank"
    assert client.patch(url, json={"name": "x"}, headers=own).status_code == 400
    assert client.patch(url, json={"contact_email": "not-an-email"}, headers=own).status_code == 400
    assert client.patch(url, json={}, headers=own).status_code == 400


# ---------------------------------------------------------------------------
# Renaming an institution's internal id
# ---------------------------------------------------------------------------

def test_renaming_an_institution_id_moves_everything_and_keeps_the_old_one_working(client):
    import sqlite3

    import config
    import security
    from agents.copilot.demo_customers import seed_institution
    from scripts import rename_institution as ren
    from tenancy import register_institution

    register_institution("oldbank", "Old Bank", "risk@old.ng")
    seed_institution("oldbank", days=30)
    assert client.post("/v1/accounts/oldbank_tunde/security/pin", json={"pin": "4821"}).status_code == 200

    def counts(conn):
        return {
            "txns": conn.execute("select count(*) from transactions where institution_id = 'oldbank'").fetchone()[0],
            "customers": conn.execute("select count(*) from transactions where user_id like 'oldbank|_%' escape '|'").fetchone()[0],
        }

    conn = sqlite3.connect(config.DB_PATH, timeout=30)
    before = counts(conn)
    assert before["txns"] > 0

    # A dry run reports the change and makes none.
    dry = ren.rename(conn, "oldbank", "newbank", do_apply=False)
    assert dry["mapping"]["oldbank_tunde"] == "newbank_tunde"
    assert counts(conn) == before

    ren.rename(conn, "oldbank", "newbank", do_apply=True)
    conn.close()

    check = sqlite3.connect(config.DB_PATH)
    assert check.execute("select count(*) from transactions where institution_id = 'oldbank'").fetchone()[0] == 0
    assert check.execute("select count(*) from transactions where institution_id = 'newbank'").fetchone()[0] == before["txns"]
    assert check.execute("select count(*) from transactions where user_id like 'oldbank|_%' escape '|'").fetchone()[0] == 0
    check.close()

    # The customer's PIN came with them, under the new id.
    assert security.status("newbank_tunde")["pin_set"] is True
    assert security.status("oldbank_tunde")["pin_set"] is False

    # The old id is still understood, so old links and open tabs keep working.
    assert client.get("/v1/branding/resolve/oldbank").json()["institution_id"] == "newbank"
    assert client.get("/v1/institutions/newbank").status_code == 200


def test_renaming_refuses_unsafe_requests(client):
    import sqlite3

    import config
    from scripts import rename_institution as ren

    conn = sqlite3.connect(config.DB_PATH, timeout=30)
    for old, new in [("endpointbank", "endpointbank"), ("endpointbank", "Bad Name!"), ("endpointbank", "demo"),
                     ("nosuchbank", "whatever")]:
        try:
            ren.rename(conn, old, new, do_apply=False)
        except ren.RenameError:
            continue
        raise AssertionError(f"{old} -> {new} should have been refused")
    conn.close()


# ---------------------------------------------------------------------------
# One definition of "fraud prevented"
# ---------------------------------------------------------------------------

def test_fraud_prevented_is_one_figure_on_every_screen(client):
    """Overview, Intelligence, Compliance and Copilot must quote the same number.
    Blocked, cancelled and held transfers count; a released one, a flag that went
    through and a plain pass do not."""
    import sessions
    from db import cursor

    rows = [
        # id, action, status, amount, counts?
        ("pv1", "BLOCK", "blocked", 100_000, True),
        ("pv2", "BLOCK", None, 50_000, True),         # older row: a block reads as blocked
        ("pv3", "FLAG", "cancelled", 30_000, True),
        ("pv4", "FLAG", "held", 20_000, True),
        ("pv5", "FLAG", "completed", 70_000, False),  # the customer verified and it went through
        ("pv6", "BLOCK", "released", 90_000, False),  # contained, then released: the money left
        ("pv7", "PASS", "completed", 40_000, False),
    ]
    with cursor() as cur:
        for tid, action, status, amount, _ in rows:
            cur.execute(
                """INSERT INTO transactions (id, user_id, amount, action_taken, status, institution_id)
                   VALUES (?, 'protectbank_ada', ?, ?, ?, 'protectbank')""",
                (tid, amount, action, status),
            )
    expected = sum(r[3] for r in rows if r[4])
    assert expected == 200_000

    from intelligence.context import fraud_prevented, institution_summary
    assert fraud_prevented("protectbank") == expected
    assert institution_summary("protectbank")["fraud_prevented_ngn"] == expected

    session = {"X-Fable-Session": sessions.issue("risk@protect.ng", "protectbank")["token"]}
    stats = client.get("/v1/dashboard/stats", headers=session).json()
    compliance = client.get("/v1/dashboard/compliance", headers=session).json()
    assert stats["fraud_prevented_ngn"] == expected
    assert compliance["fraud_prevented_ngn"] == expected
