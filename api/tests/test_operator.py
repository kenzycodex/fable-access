"""The operator platform: Fable staff, kept apart from every bank.

The promises: an operator signs in with a password and an authenticator code,
and a code cannot be replayed; operator and console sessions never stand in for
each other; provisioning creates an empty institution and invites its owner;
suspension cuts a bank off everywhere; going live waits for the checklist; and
no bank ever sees operator activity.
"""
import os
import sys
import tempfile

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
os.environ.setdefault("FABLE_DB_PATH", os.path.join(tempfile.mkdtemp(), "operator.db"))
os.environ.setdefault("FABLE_SESSION_SECRET", "test-secret")
os.environ.setdefault("SMTP_USERNAME", "")

OWNER = "owner@fable.test"
PASSWORD = "a-long-test-password"


@pytest.fixture(scope="module")
def client():
    from fastapi.testclient import TestClient

    from main import app
    from scripts.create_operator import create

    create(OWNER, "Platform Owner", "platform_owner", PASSWORD)
    return TestClient(app)


def _sign_in(client, email=OWNER, password=PASSWORD) -> dict:
    """An operator session. An operator who has never signed in goes through
    the real flow (password, then enrolling the authenticator). One already
    enrolled is given a session directly, because a code cannot be reused and a
    test would otherwise wait 30 seconds for the next one; the full flow,
    including the refusal of a reused code, is the first test below."""
    from core import operators, totp

    op = operators.get(email)
    if op and op.get("totp_enabled"):
        return {"X-Fable-Operator": operators.issue_session(email, op.get("session_version") or 0)["token"]}
    first = client.post("/operator/auth/login", json={"email": email, "password": password})
    assert first.status_code == 200, first.text
    body = first.json()
    res = client.post("/operator/auth/verify",
                      json={"challenge": body["challenge"], "code": totp.code_at(body["secret"], totp.current_step())})
    assert res.status_code == 200, res.text
    return {"X-Fable-Operator": res.json()["token"]}


def test_first_sign_in_enrols_an_authenticator_and_codes_cannot_be_replayed(client):
    from core import operators, totp

    first = client.post("/operator/auth/login", json={"email": OWNER, "password": PASSWORD}).json()
    assert first["step"] == "enroll" and first["otpauth_uri"].startswith("otpauth://totp/")
    code = totp.code_at(first["secret"], totp.current_step())
    ok = client.post("/operator/auth/verify", json={"challenge": first["challenge"], "code": code})
    assert ok.status_code == 200
    assert operators.get(OWNER)["totp_enabled"] == 1
    assert operators.get(OWNER)["totp_secret"] != first["secret"]  # stored sealed, not in the clear

    again = client.post("/operator/auth/login", json={"email": OWNER, "password": PASSWORD}).json()
    assert again["step"] == "mfa" and "secret" not in again
    replay = client.post("/operator/auth/verify", json={"challenge": again["challenge"], "code": code})
    assert replay.status_code == 401

    assert client.post("/operator/auth/login", json={"email": OWNER, "password": "wrong-password"}).status_code == 401


def test_operator_and_console_sessions_never_stand_in_for_each_other(client):
    from core import sessions

    op = _sign_in(client)
    assert client.get("/operator/me", headers=op).json()["email"] == OWNER
    console = {"X-Fable-Session": sessions.issue("risk@x.ng", "xbank")["token"]}
    assert client.get("/operator/institutions", headers=console).status_code == 401
    assert client.get("/v1/dashboard/stats", headers={"X-Fable-Session": op["X-Fable-Operator"]}).status_code == 401
    assert client.get("/operator/institutions").status_code == 401


def test_provisioning_creates_an_empty_bank_and_invites_its_owner(client):
    from core.db import cursor

    op = _sign_in(client)
    made = client.post("/operator/institutions", headers=op,
                       json={"name": "Clean Slate MFB", "type": "Microfinance Bank", "owner_email": "Boss@CleanSlate.ng"})
    assert made.status_code == 201, made.text
    body = made.json()
    inst = body["institution"]["institution_id"]
    assert inst == "clean_slate_mfb"
    assert body["institution"]["mode"] == "sandbox"
    assert body["owner_invite"]["invite_link"]  # no email server here, so the link comes back
    with cursor() as cur:
        for table in ("customers", "transactions", "transaction_history", "api_keys", "accounts", "ghost_containers"):
            cur.execute(f"SELECT COUNT(*) FROM {table} WHERE institution_id = ?", (inst,))
            assert cur.fetchone()[0] == 0, table
        cur.execute("SELECT role, active FROM admins WHERE email = 'boss@cleanslate.ng'")
        assert tuple(cur.fetchone()) == ("owner", 2)  # invited, cannot sign in until the link is used

    assert client.post("/operator/institutions", headers=op,
                       json={"name": "Clean Slate MFB", "owner_email": "x@y.ng"}).status_code == 409
    detail = client.get(f"/operator/institutions/{inst}", headers=op).json()
    assert detail["onboarding"]["ready_to_go_live"] is False


def test_only_the_right_roles_act(client):
    from scripts.create_operator import create

    create("support@fable.test", "Support", "support", PASSWORD)
    support = _sign_in(client, "support@fable.test")
    assert client.get("/operator/institutions", headers=support).status_code == 200
    assert client.post("/operator/institutions", headers=support,
                       json={"name": "Nope Bank", "owner_email": "a@nope.ng"}).status_code == 403
    assert client.post("/operator/team", headers=support, json={"email": "z@fable.test"}).status_code == 403


def test_suspension_cuts_a_bank_off_and_reactivation_restores_it(client):
    from core import sessions
    from core.tenancy import register_institution

    register_institution("pausebank", "Pause Bank", "risk@pause.ng")
    op = _sign_in(client)
    console = {"X-Fable-Session": sessions.issue("risk@pause.ng", "pausebank")["token"]}
    assert client.get("/v1/dashboard/stats", headers=console).status_code == 200
    assert client.post("/operator/institutions/pausebank/suspend", headers=op, json={"reason": "Security review"}).json()["status"] == "suspended"
    assert client.get("/v1/dashboard/stats", headers=console).status_code == 403
    client.post("/operator/institutions/pausebank/reactivate", headers=op)
    assert client.get("/v1/dashboard/stats", headers=console).status_code == 200


def test_operator_team_invites_and_keeps_an_owner(client):
    op = _sign_in(client)
    invited = client.post("/operator/team", headers=op, json={"email": "new@fable.test", "role": "platform_admin"}).json()
    token = invited["invite_link"].split("token=")[1]
    assert client.post("/operator/auth/accept-invite", json={"token": token, "password": "short"}).status_code == 422
    assert client.post("/operator/auth/accept-invite", json={"token": token, "password": PASSWORD}).status_code == 200
    assert client.post("/operator/auth/accept-invite", json={"token": token, "password": PASSWORD}).status_code == 400
    assert _sign_in(client, "new@fable.test")
    assert client.delete(f"/operator/team/{OWNER}", headers=op).status_code == 409  # yourself

    # Other tests share this database and may have made more platform owners;
    # leave exactly one, then check it can't be demoted.
    from core.db import cursor

    with cursor() as cur:
        cur.execute("UPDATE operators SET role = 'support' WHERE role = 'platform_owner' AND email != ?", (OWNER,))
    assert client.patch(f"/operator/team/{OWNER}", headers=op, json={"role": "support"}).status_code == 409  # last owner


def test_going_live_waits_for_the_checklist(client):
    from core import apikeys, customers, sessions
    from core.db import cursor
    from core.tenancy import register_institution

    register_institution("readybank", "Ready Bank", "risk@ready.ng")
    owner = {"X-Fable-Session": sessions.issue("risk@ready.ng", "readybank")["token"]}
    blocked = client.put("/v1/institutions/readybank/mode", headers=owner, json={"mode": "live"})
    assert blocked.status_code == 409
    assert set(blocked.json()["detail"]["remaining"]) == {"agreements", "api_key", "webhook", "policy", "customers"}

    client.post("/v1/onboarding/agreements", headers=owner, json={"data_processing_agreement": True, "dpia": True})
    customers.create("readybank", "CIF-1", kind="real", source="console")
    with cursor() as cur:
        apikeys.insert(cur, apikeys.generate(), "readybank", "Ready Bank", "risk@ready.ng")
        cur.execute("INSERT INTO institution_settings (institution_id, updated_by) VALUES ('readybank', 'risk@ready.ng')")
        cur.execute("INSERT INTO webhooks (id, institution_id, url, secret, events, active) VALUES ('wh_r', 'readybank', 'https://r.ng/h', 's', '*', 1)")
        cur.execute("INSERT INTO webhook_deliveries (webhook_id, institution_id, event, status_code, ok) VALUES ('wh_r', 'readybank', 'test', 200, 1)")
    assert client.get("/v1/onboarding", headers=owner).json()["ready_to_go_live"] is True
    assert client.put("/v1/institutions/readybank/mode", headers=owner, json={"mode": "live"}).status_code == 200


def test_no_bank_sees_operator_activity(client):
    from core import sessions

    _sign_in(client)
    console = {"X-Fable-Session": sessions.issue("risk@pause.ng", "pausebank")["token"]}
    events = client.get("/v1/dashboard/compliance", headers=console).json()
    text = str(events)
    assert "operator.login" not in text and OWNER not in text


def test_the_overview_and_list_show_setup_progress_and_what_needs_attention(client):
    op = _sign_in(client)
    client.post("/operator/institutions", headers=op,
                json={"name": "Waiting Owner MFB", "owner_email": "owner@waiting.ng"})
    listed = {r["institution_id"]: r for r in client.get("/operator/institutions", headers=op).json()["institutions"]}
    waiting = listed["waiting_owner_mfb"]
    assert waiting["setup_total"] > 0 and waiting["setup_done"] < waiting["setup_total"]
    assert waiting["invites_pending"] == 1 and waiting["owners"] == 0

    overview = client.get("/operator/overview", headers=op).json()
    assert overview["institutions"] == len(listed)
    assert sum(overview["stages"].values()) == len(listed)
    reasons = {a["institution_id"]: a["reason"] for a in overview["attention"]}
    assert reasons["waiting_owner_mfb"] == "Owner hasn't accepted the invite"


def test_only_a_platform_owner_changes_ask_fable_limits_and_every_change_is_recorded(client):
    from core import operators
    from core.db import cursor
    from scripts.create_operator import create

    create("limits-support@fable.test", "Support", "support", PASSWORD)
    with cursor() as cur:
        cur.execute("UPDATE operators SET totp_enabled = 1 WHERE email = 'limits-support@fable.test'")
    support = {"X-Fable-Operator": operators.issue_session("limits-support@fable.test", 0)["token"]}
    owner = _sign_in(client)

    seen = client.get("/operator/assistant", headers=support).json()
    assert seen["settings"]["per_person_per_minute"] == seen["fields"]["per_person_per_minute"]["default"]
    assert client.put("/operator/assistant", headers=support, json={"per_person_per_minute": 2}).status_code == 403
    assert client.put("/operator/assistant", headers=owner, json={"per_person_per_minute": 0}).status_code == 400
    assert client.put("/operator/assistant", headers=owner, json={"nonsense": 1}).status_code == 400

    saved = client.put("/operator/assistant", headers=owner, json={"per_person_per_minute": 4, "ai_enabled": False})
    assert saved.status_code == 200 and saved.json()["settings"]["per_person_per_minute"] == 4
    audit = client.get("/operator/audit", headers=owner).json()["events"]
    assert audit[0]["event_type"] == "platform.assistant_changed"
    assert audit[0]["payload"]["changes"]["per_person_per_minute"] == {"from": 6, "to": 4}

    with cursor() as cur:
        cur.execute("DELETE FROM platform_settings WHERE key LIKE 'assistant.%'")


def test_an_admin_overrides_ask_fable_for_one_bank(client):
    op = _sign_in(client)
    client.post("/operator/institutions", headers=op, json={"name": "Quiet Bank", "owner_email": "o@quiet.ng"})
    r = client.put("/operator/institutions/quiet_bank/assistant", headers=op, json={"enabled": False, "daily_answers": 25})
    assert r.status_code == 200 and r.json()["enabled"] is False and r.json()["daily_answers"] == 25
    detail = client.get("/operator/institutions/quiet_bank", headers=op).json()
    assert detail["assistant"]["override"]["daily_answers"] == 25
    assert client.put("/operator/institutions/nobody/assistant", headers=op, json={"enabled": True}).status_code == 404


def test_the_audit_log_pages_filters_and_keeps_bank_events_from_support(client):
    from core import operators
    from core.db import cursor
    from scripts.create_operator import create

    op = _sign_in(client)
    with cursor() as cur:
        for n in range(7):
            cur.execute("INSERT INTO audit_log (user_id, institution_id, event_type, payload) VALUES (?, 'auditbank', ?, ?)",
                        (f"cus_{n}", "security.access_denied" if n % 2 else "policy.changed", '{"by": "risk@auditbank.ng"}'))

    first = client.get("/operator/audit?scope=all&institution=auditbank&limit=3", headers=op).json()
    assert len(first["events"]) == 3 and first["next_before"]
    rest = client.get(f"/operator/audit?scope=all&institution=auditbank&limit=10&before={first['next_before']}", headers=op).json()
    assert len(rest["events"]) == 4 and rest["next_before"] is None
    assert {t["event_type"] for t in first["types"]} == {"security.access_denied", "policy.changed"}
    security = client.get("/operator/audit?scope=security&institution=auditbank", headers=op).json()["events"]
    assert {e["event_type"] for e in security} == {"security.access_denied"}
    assert security[0]["actor"] == "risk@auditbank.ng"

    create("audit-support@fable.test", "Support", "support", PASSWORD)
    with cursor() as cur:
        cur.execute("UPDATE operators SET totp_enabled = 1 WHERE email = 'audit-support@fable.test'")
    support = {"X-Fable-Operator": operators.issue_session("audit-support@fable.test", 0)["token"]}
    assert client.get("/operator/audit?scope=all", headers=support).status_code == 403
    assert client.get("/operator/audit?scope=operators", headers=support).status_code == 200

    csv_ = client.get("/operator/audit/export.csv?scope=all&institution=auditbank", headers=op)
    assert csv_.status_code == 200 and csv_.text.count("\n") == 8
    assert client.get("/operator/audit?scope=operators", headers=op).json()["events"][0]["event_type"] == "operator.audit_exported"
