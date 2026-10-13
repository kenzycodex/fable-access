"""The console as a workspace: review cases, roles, policy, webhooks, exports.

Each test pins a promise the console makes to a bank:
  * a case can only be seen and worked by the bank it belongs to;
  * a role can only do what its role allows, checked on the server;
  * a bank's own thresholds actually change Shield's decision;
  * webhooks are signed, and cannot be pointed at the server's own network;
  * an export only ever contains the caller's own rows;
  * a live institution cannot be written to by name alone.
"""
import hashlib
import hmac
import os
import sys
import tempfile

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
os.environ.setdefault("FABLE_DB_PATH", os.path.join(tempfile.mkdtemp(), "workflows.db"))
os.environ.setdefault("FABLE_SESSION_SECRET", "test-secret")
os.environ.setdefault("FABLE_OPERATOR_KEY", "test-operator-key")
os.environ.setdefault("SMTP_USERNAME", "")

BANK = "workbank"
OTHER = "otherbank"
OWNER = "owner@workbank.ng"
ANALYST = "analyst@workbank.ng"
VIEWER = "viewer@workbank.ng"
STRANGER = "owner@otherbank.ng"


def _admin(email: str, inst: str, role: str) -> None:
    from db import cursor
    from utils import hash_password

    with cursor() as cur:
        cur.execute(
            """INSERT OR REPLACE INTO admins (email, institution_id, hashed_password, role, name, active)
               VALUES (?, ?, ?, ?, ?, 1)""",
            (email, inst, hash_password("correct-horse-1"), role, email.split("@")[0]),
        )


def _headers(email: str, inst: str = BANK) -> dict:
    import sessions

    return {"X-Fable-Session": sessions.issue(email, inst)["token"]}


@pytest.fixture(scope="module")
def client():
    from fastapi.testclient import TestClient
    from main import app
    from tenancy import register_institution
    from agents.copilot.demo_customers import seed_institution

    register_institution(BANK, "Work Bank", "risk@workbank.ng")
    register_institution(OTHER, "Other Bank", "risk@otherbank.ng")
    seed_institution(BANK, days=60)
    seed_institution(OTHER, days=30)
    _admin(OWNER, BANK, "owner")
    _admin(ANALYST, BANK, "analyst")
    _admin(VIEWER, BANK, "viewer")
    _admin(STRANGER, OTHER, "owner")
    with TestClient(app) as c:
        yield c


def _open_case(client, inst: str = BANK, who: str = OWNER) -> dict:
    body = client.get("/v1/review/queue?state=open&limit=5", headers=_headers(who, inst)).json()
    assert body["cases"], "seeded history should contain flagged or blocked transfers"
    return body["cases"][0]


# --- Review queue -----------------------------------------------------------

def test_queue_needs_a_credential(client):
    assert client.get("/v1/review/queue").status_code == 401


def test_every_flag_and_block_starts_as_an_open_case(client):
    counts = client.get("/v1/review/counts", headers=_headers(OWNER)).json()
    assert counts["open"] > 0
    case = _open_case(client)
    assert case["action_taken"] in ("FLAG", "BLOCK")
    assert case["review_state"] == "open"


def test_analyst_works_a_case_end_to_end(client):
    h = _headers(ANALYST)
    case = _open_case(client)
    txid = case["id"]

    r = client.post(f"/v1/review/{txid}/assign", json={"assignee": "me"}, headers=h)
    assert r.status_code == 200 and r.json()["review_state"] == "in_review"

    r = client.post(f"/v1/review/{txid}/notes", json={"body": "Called the customer; they did not send this."}, headers=h)
    assert r.status_code == 200

    r = client.post(f"/v1/review/{txid}/resolve", json={"outcome": "fraud"}, headers=h)
    assert r.status_code == 200 and r.json()["review_outcome"] == "fraud"

    detail = client.get(f"/v1/review/{txid}", headers=h).json()
    assert detail["case"]["review_state"] == "resolved"
    assert detail["case"]["reviewed_by"] == ANALYST
    assert [n["body"] for n in detail["notes"]] == ["Called the customer; they did not send this."]
    assert {a["event_type"] for a in detail["activity"]} >= {"case.assigned", "case.noted", "case.resolved"}

    # Fraud must never become part of what Copilot treats as normal.
    from db import cursor

    with cursor() as cur:
        cur.execute("SELECT confirmed_legitimate FROM transactions WHERE id = ?", (txid,))
        assert cur.fetchone()["confirmed_legitimate"] == 0

    # Resolved cases refuse further routing until reopened.
    assert client.post(f"/v1/review/{txid}/escalate", json={}, headers=h).status_code == 409
    assert client.post(f"/v1/review/{txid}/reopen", headers=h).status_code == 200


def test_another_bank_cannot_see_or_touch_a_case(client):
    txid = _open_case(client)["id"]
    h = _headers(STRANGER, OTHER)
    assert client.get(f"/v1/review/{txid}", headers=h).status_code == 404
    assert client.post(f"/v1/review/{txid}/resolve", json={"outcome": "legitimate"}, headers=h).status_code == 404
    queue = client.get("/v1/review/queue?limit=200", headers=h).json()["cases"]
    assert all(c["id"] != txid for c in queue)


def test_viewer_reads_but_cannot_resolve(client):
    txid = _open_case(client)["id"]
    h = _headers(VIEWER)
    assert client.get(f"/v1/review/{txid}", headers=h).status_code == 200
    assert client.post(f"/v1/review/{txid}/resolve", json={"outcome": "fraud"}, headers=h).status_code == 403


def test_feedback_is_scoped_to_the_callers_bank(client):
    txid = _open_case(client)["id"]
    payload = {"user_id": "x", "transaction_id": txid, "was_fraud": False}
    assert client.post("/v1/shield/feedback", json=payload).status_code == 401
    assert client.post("/v1/shield/feedback", json=payload, headers=_headers(STRANGER, OTHER)).status_code == 404
    r = client.post("/v1/shield/feedback", json=payload, headers=_headers(ANALYST))
    assert r.status_code == 200 and r.json()["outcome"] == "legitimate"


# --- Roles and team ---------------------------------------------------------

def test_only_owners_change_policy_people_and_keys(client):
    for who in (ANALYST, VIEWER):
        h = _headers(who)
        assert client.put(f"/v1/institutions/{BANK}/settings", json={"flag_threshold": 0.4}, headers=h).status_code == 403
        assert client.post("/v1/team/invite", json={"email": "x@workbank.ng"}, headers=h).status_code == 403
        assert client.post(f"/v1/institutions/{BANK}/keys/rotate", headers=h).status_code == 403
        assert client.patch(f"/v1/branding/{BANK}", json={"tagline": "x"}, headers=h).status_code == 403


def test_branding_writes_need_the_owning_bank(client):
    assert client.patch(f"/v1/branding/{BANK}", json={"tagline": "hijacked"}).status_code == 401
    assert client.patch(f"/v1/branding/{BANK}", json={"tagline": "hijacked"}, headers=_headers(STRANGER, OTHER)).status_code == 404
    assert client.patch(f"/v1/branding/{BANK}", json={"tagline": "Ours"}, headers=_headers(OWNER)).status_code == 200


def test_credentials_never_return_the_key_itself(client):
    owner = client.get(f"/v1/institutions/{BANK}/credentials", headers=_headers(OWNER)).json()
    analyst = client.get(f"/v1/institutions/{BANK}/credentials", headers=_headers(ANALYST)).json()
    assert owner["api_key"] is None and analyst["api_key"] is None
    assert owner["can_manage"] is True and analyst["can_manage"] is False


def test_invite_accept_and_remove(client):
    h = _headers(OWNER)
    r = client.post("/v1/team/invite", json={"email": "New.Analyst@workbank.ng", "role": "analyst"}, headers=h)
    assert r.status_code == 200
    link = r.json()["invite_link"]  # no SMTP in tests, so the owner gets the link
    token = link.split("token=")[1].split("&")[0]

    # An invited member cannot sign in until they accept.
    assert client.post("/auth/login", json={"email": "new.analyst@workbank.ng", "password": "whatever-123"}).status_code == 401
    assert client.post("/auth/reset-password", json={"token": token, "new_password": "brand-new-pass"}).status_code == 200
    login = client.post("/auth/login", json={"email": "NEW.analyst@workbank.ng", "password": "brand-new-pass"})
    assert login.status_code == 200 and login.json()["role"] == "analyst"

    session = {"X-Fable-Session": login.json()["token"]}
    assert client.get("/v1/review/counts", headers=session).status_code == 200

    # Removal takes effect on the very next request, not when the token expires.
    assert client.delete("/v1/team/new.analyst@workbank.ng", headers=h).status_code == 200
    assert client.get("/v1/review/counts", headers=session).status_code == 401


def test_last_owner_cannot_be_removed_or_demoted(client):
    h = _headers(OWNER)
    assert client.patch(f"/v1/team/{OWNER}", json={"role": "viewer"}, headers=h).status_code == 409
    assert client.delete(f"/v1/team/{OWNER}", headers=h).status_code == 409


def test_change_password_uses_the_session_not_the_body(client):
    body = {"email": OWNER, "old_password": "correct-horse-1", "new_password": "another-pass-2"}
    assert client.post("/auth/change-password", json=body).status_code == 401
    r = client.post("/auth/change-password", json=body, headers=_headers(OWNER))
    assert r.status_code == 200
    _admin(OWNER, BANK, "owner")  # restore for later tests


# --- Risk policy ------------------------------------------------------------

def test_policy_validation(client):
    h = _headers(OWNER)
    bad = [
        {"flag_threshold": 0.8, "block_threshold": 0.78},
        {"flag_threshold": 0.05},
        {"hold_high_minutes": 2},
        {"hold_high_minutes": 10, "hold_low_minutes": 30},
    ]
    for body in bad:
        assert client.put(f"/v1/institutions/{BANK}/settings", json=body, headers=h).status_code == 422, body


def test_institution_thresholds_change_the_decision(client):
    import policy
    from agents.shield.analyzer import analyze_transaction

    from agents.copilot.demo_customers import user_id_for

    user = user_id_for(BANK, "chioma")
    # A transfer that lands mid-range under the defaults, found rather than
    # hardcoded so the test does not break every time a weight is tuned.
    txn = None
    for amount in (8000, 20000, 45000, 90000, 180000, 300000):
        for payee in ("brand_new_payee", None):
            candidate = {"amount": amount, "recipient_account": "0123456789", "recipient_bank": "Unknown Bank",
                         "narration": "transfer", "channel": "mobile_app",
                         **({"recipient_id": payee} if payee else {})}
            s = analyze_transaction(user, candidate, {}, {}, BANK)["risk_score"]
            if 0.25 <= s <= 0.85:
                txn = candidate
                break
        if txn:
            break
    assert txn is not None, "no mid-range transfer found to test thresholds with"

    try:
        policy.update(BANK, {"flag_threshold": 0.2, "block_threshold": 0.95}, "test")
        assert analyze_transaction(user, txn, {}, {}, BANK)["action"] != "PASS"
        policy.update(BANK, {"flag_threshold": 0.9, "block_threshold": 0.95}, "test")
        assert analyze_transaction(user, txn, {}, {}, BANK)["action"] == "PASS"
        # Another bank is untouched by this one's policy.
        assert policy.base_thresholds(OTHER) is None
    finally:
        policy.update(BANK, {"flag_threshold": None, "block_threshold": None}, "test")


def test_hold_windows_follow_policy():
    import policy
    from agents.ghost.account import calculate_cooling_window

    try:
        policy.update(BANK, {"hold_high_minutes": 60, "hold_medium_minutes": 30, "hold_low_minutes": 10}, "test")
        assert calculate_cooling_window(0.95, BANK) == 60
        assert calculate_cooling_window(0.5, BANK) == 10
    finally:
        policy.update(BANK, {"hold_high_minutes": None, "hold_medium_minutes": None, "hold_low_minutes": None}, "test")


# --- Webhooks ---------------------------------------------------------------

def test_webhook_urls_cannot_reach_internal_networks(monkeypatch):
    import webhooks

    monkeypatch.delenv("FABLE_WEBHOOK_ALLOW_PRIVATE", raising=False)
    for url in ("http://example.com/hook", "https://127.0.0.1/hook", "https://10.0.0.5/hook", "ftp://x/y"):
        with pytest.raises(webhooks.WebhookError):
            webhooks.validate_url(url)


def test_webhook_deliveries_are_signed_and_retried(client, monkeypatch):
    import webhooks

    monkeypatch.setenv("FABLE_WEBHOOK_ALLOW_PRIVATE", "1")
    r = client.post("/v1/webhooks", json={"url": "http://localhost:9/hook", "events": ["case.resolved"]},
                    headers=_headers(OWNER))
    assert r.status_code == 200
    hook = {**r.json(), "institution_id": BANK}
    secret = r.json()["secret"]
    assert client.get("/v1/webhooks", headers=_headers(OWNER)).json()["endpoints"][0].get("secret") is None

    calls = []

    def fake_post(url, body, headers):
        calls.append((body, headers))
        return 500 if len(calls) < 2 else 200

    monkeypatch.setattr(webhooks, "_post", fake_post)
    assert webhooks.deliver(hook, "case.resolved", {"id": "t1"}, sleep=lambda _s: None) is True
    assert len(calls) == 2  # one failure, one retry that landed

    body, headers = calls[-1]
    t, v1 = (part.split("=", 1)[1] for part in headers["Fable-Signature"].split(","))
    expected = hmac.new(secret.encode(), f"{t}.".encode() + body, hashlib.sha256).hexdigest()
    assert hmac.compare_digest(v1, expected)

    log = client.get(f"/v1/webhooks/{hook['id']}/deliveries", headers=_headers(OWNER)).json()["deliveries"]
    assert [d["ok"] for d in log][:2] == [True, False]
    assert client.get(f"/v1/webhooks/{hook['id']}/deliveries", headers=_headers(STRANGER, OTHER)).status_code == 404


def test_resolving_a_case_emits_a_webhook(client, monkeypatch):
    import webhooks

    sent = []
    monkeypatch.setattr(webhooks, "emit", lambda inst, event, data: sent.append((inst, event, data)))
    txid = _open_case(client)["id"]
    client.post(f"/v1/review/{txid}/resolve", json={"outcome": "legitimate"}, headers=_headers(ANALYST))
    assert sent and sent[-1][0] == BANK and sent[-1][1] == "case.resolved"
    assert sent[-1][2]["review_outcome"] == "legitimate"
    assert "device_fingerprint" not in sent[-1][2]


# --- Exports ----------------------------------------------------------------

def test_export_contains_only_the_callers_rows(client):
    r = client.get("/v1/dashboard/export/transactions.csv", headers=_headers(STRANGER, OTHER))
    assert r.status_code == 200 and r.headers["content-type"].startswith("text/csv")
    assert f"{BANK}_" not in r.text
    assert client.get("/v1/dashboard/export/transactions.csv").status_code == 401
    assert client.get("/v1/dashboard/export/transactions.csv?from=yesterday", headers=_headers(OWNER)).status_code == 400
    audit_csv = client.get("/v1/dashboard/export/audit.csv", headers=_headers(OWNER))
    assert audit_csv.status_code == 200 and audit_csv.text.startswith("id,created_at_utc")


def test_date_range_filters_transactions(client):
    h = _headers(OWNER)
    everything = client.get("/v1/dashboard/transactions?limit=1", headers=h).json()["total"]
    none = client.get("/v1/dashboard/transactions?limit=1&from=2099-01-01", headers=h).json()["total"]
    assert everything > 0 and none == 0


# --- Live mode --------------------------------------------------------------

def test_live_institution_rejects_keyless_writes(client):
    from db import cursor

    from agents.copilot.demo_customers import user_id_for

    payload = {"user_id": user_id_for(BANK, "chioma"), "institution_id": BANK,
               "transaction": {"amount": 1000, "recipient_id": "r", "recipient_account": "0000000001",
                               "recipient_bank": "Test", "channel": "mobile_app"}}
    try:
        r = client.put(f"/v1/institutions/{BANK}/mode", json={"mode": "live"}, headers=_headers(OWNER))
        assert r.status_code == 200
        assert client.post("/v1/shield/analyze", json=payload).status_code == 401

        key = client.post(f"/v1/institutions/{BANK}/keys/rotate", headers=_headers(OWNER)).json()["api_key"]
        assert client.post("/v1/shield/analyze", json=payload, headers={"X-API-Key": key}).status_code == 200
    finally:
        with cursor() as cur:
            cur.execute("UPDATE institutions SET mode = 'sandbox' WHERE institution_id = ?", (BANK,))

    # Sandbox banks, like every demo bank, still accept scoring by name.
    other = {**payload, "user_id": user_id_for(OTHER, "chioma"), "institution_id": OTHER}
    assert client.post("/v1/shield/analyze", json=other).status_code != 401


def test_board_report_is_computed_over_the_range(client):
    h = _headers(OWNER)
    r = client.get("/v1/dashboard/report", headers=h)
    assert r.status_code == 200
    body = r.json()
    assert body["institution"]["id"] == BANK
    assert body["volume"]["transactions"] == body["volume"]["passed"] + body["volume"]["flagged"] + body["volume"]["blocked"]
    empty = client.get("/v1/dashboard/report?from=2099-01-01", headers=h).json()
    assert empty["volume"]["transactions"] == 0 and empty["review"]["precision"] is None
    assert client.get("/v1/dashboard/report").status_code == 401


def test_a_renamed_admin_is_not_recreated_on_restart():
    """Changing the console email used to leave both addresses able to sign in,
    because startup re-seeded the configured one whenever it was missing."""
    import main
    from db import cursor

    with cursor() as cur:
        cur.execute("DELETE FROM admins WHERE email = ?", (main.DEFAULT_ADMIN_EMAIL,))
        cur.execute(
            "INSERT OR REPLACE INTO admins (email, institution_id, hashed_password) VALUES (?, ?, 'x')",
            ("renamed@meridian.ng", main.DEFAULT_ADMIN_INSTITUTION),
        )
    main.ensure_default_admin()
    with cursor() as cur:
        cur.execute("SELECT 1 FROM admins WHERE email = ?", (main.DEFAULT_ADMIN_EMAIL,))
        assert cur.fetchone() is None


# --- API keys are stored as hashes -----------------------------------------

def test_an_existing_plain_text_key_keeps_working_after_conversion(client):
    """Keys issued before hashing were stored as-is. Converting them must not
    break the integrations already using them."""
    import db
    from tenancy import institution_from_api_key

    raw = "fbl_live_" + "ab" * 16
    with db.cursor() as cur:
        cur.execute(
            "INSERT INTO api_keys (key, institution_name, admin_email, institution_id) VALUES (?, 'Work Bank', ?, ?)",
            (raw, OWNER, BANK),
        )
    db._migrate(db.get_conn())

    with db.cursor() as cur:
        cur.execute("SELECT key, key_prefix, key_last4 FROM api_keys WHERE key_last4 = 'abab' AND key_prefix = ?", (raw[:13],))
        row = cur.fetchone()
    assert row is not None and row["key"].startswith("sha256:") and raw not in row["key"]
    assert institution_from_api_key(raw) == BANK
    db._migrate(db.get_conn())  # a second run changes nothing
    assert institution_from_api_key(raw) == BANK


def test_no_raw_key_is_ever_stored(client):
    import db

    key = client.post(f"/v1/institutions/{BANK}/keys/rotate", headers=_headers(OWNER)).json()["api_key"]
    assert key.startswith("fbl_live_")
    with db.cursor() as cur:
        cur.execute("SELECT key FROM api_keys")
        stored = [r["key"] for r in cur.fetchall()]
    assert all(s.startswith("sha256:") for s in stored)
    assert key not in stored
    masked = client.get(f"/v1/institutions/{BANK}/credentials", headers=_headers(OWNER)).json()["masked_key"]
    assert masked.startswith(key[:13]) and masked.endswith(key[-4:])
    # The key works for the integration, and an old one stops working after rotation.
    payload = {"user_id": "x", "transaction_id": "none", "was_fraud": False}
    assert client.post("/v1/shield/feedback", json=payload, headers={"X-API-Key": key}).status_code == 404
    assert client.post("/v1/shield/feedback", json=payload, headers={"X-API-Key": "fbl_live_" + "0" * 32}).status_code == 401


# --- Sign-in hardening ------------------------------------------------------

def test_changing_a_password_ends_other_sessions_but_not_this_one(client):
    email = "rotator@workbank.ng"
    _admin(email, BANK, "analyst")
    login = client.post("/auth/login", json={"email": email, "password": "correct-horse-1"}).json()
    old = {"X-Fable-Session": login["token"]}
    other = {"X-Fable-Session": client.post("/auth/login", json={"email": email, "password": "correct-horse-1"}).json()["token"]}
    assert client.get("/v1/review/counts", headers=old).status_code == 200

    r = client.post("/auth/change-password", json={"old_password": "correct-horse-1", "new_password": "fresh-pass-99"}, headers=old)
    assert r.status_code == 200 and r.json()["token"]
    fresh = {"X-Fable-Session": r.json()["token"]}

    assert client.get("/v1/review/counts", headers=other).status_code == 401  # ended
    assert client.get("/v1/review/counts", headers=old).status_code == 401    # ended too
    assert client.get("/v1/review/counts", headers=fresh).status_code == 200  # the one that changed it carries on


def test_reset_links_are_stored_hashed_and_only_the_latest_works(client):
    import db
    from routers.auth import token_hash

    email = "forgetful@workbank.ng"
    _admin(email, BANK, "viewer")
    # Two requests: only the second link may work, and no raw token is stored.
    client.post("/auth/forgot-password", json={"email": email})
    client.post("/auth/forgot-password", json={"email": email})
    with db.cursor() as cur:
        cur.execute("SELECT token FROM password_resets WHERE email = ?", (email,))
        rows = [r["token"] for r in cur.fetchall()]
    assert len(rows) == 1 and rows[0].startswith("sha256:")

    # A known token, stored the way the app stores it, resets the password once.
    with db.cursor() as cur:
        cur.execute("DELETE FROM password_resets WHERE email = ?", (email,))
        cur.execute("INSERT INTO password_resets (token, email, expires_at) VALUES (?, ?, ?)",
                    (token_hash("known-token"), email, 9_999_999_999))
    assert client.post("/auth/reset-password", json={"token": "known-token", "new_password": "brand-new-1"}).status_code == 200
    assert client.post("/auth/reset-password", json={"token": "known-token", "new_password": "again-again-1"}).status_code == 400


def test_password_guessing_is_throttled(client):
    email = "target@workbank.ng"
    _admin(email, BANK, "viewer")
    for _ in range(5):
        assert client.post("/auth/login", json={"email": email, "password": "wrong-guess"}).status_code == 401
    blocked = client.post("/auth/login", json={"email": email, "password": "correct-horse-1"})
    assert blocked.status_code == 429  # even the right password waits out the window
    assert "Retry-After" in blocked.headers
    # Another account is unaffected.
    assert client.post("/auth/login", json={"email": OWNER, "password": "correct-horse-1"}).status_code == 200


def test_live_mode_protects_every_customer_endpoint(client):
    """Live mode used to guard scoring only. A live bank's balances, verification,
    holds and notifications must need its key too, while sandbox banks stay open."""
    from agents.copilot.demo_customers import user_id_for
    from db import cursor

    user = user_id_for(BANK, "tunde")
    other_user = user_id_for(OTHER, "tunde")
    key = client.post(f"/v1/institutions/{BANK}/keys/rotate", headers=_headers(OWNER)).json()["api_key"]
    other_key = client.post(f"/v1/institutions/{OTHER}/keys/rotate", headers=_headers(STRANGER, OTHER)).json()["api_key"]
    try:
        client.put(f"/v1/institutions/{BANK}/mode", json={"mode": "live"}, headers=_headers(OWNER))
        probes = [
            ("get", f"/v1/accounts/{user}", None),
            ("get", f"/v1/accounts/{user}/security", None),
            ("get", f"/v1/notifications/{user}", None),
            ("get", f"/v1/copilot/transparency/{user}", None),
            ("get", f"/v1/demo/overview/{user}?institution={BANK}", None),
            ("post", "/v1/stepup/requirement", {"user_id": user, "risk_score": 0.6, "signals": [], "action": "FLAG", "purpose": "transfer"}),
        ]
        for method, path, body in probes:
            call = getattr(client, method)
            kwargs = {"json": body} if body is not None else {}
            assert call(path, **kwargs).status_code == 401, path
            assert call(path, headers={"X-API-Key": other_key}, **kwargs).status_code == 401, path
            assert call(path, headers={"X-API-Key": key}, **kwargs).status_code != 401, path
    finally:
        with cursor() as cur:
            cur.execute("UPDATE institutions SET mode = 'sandbox' WHERE institution_id = ?", (BANK,))

    # A sandbox bank's customers stay reachable without a key, as the demo needs.
    assert client.get(f"/v1/accounts/{other_user}/security").status_code != 401
    assert client.get(f"/v1/accounts/{user}/security").status_code != 401
