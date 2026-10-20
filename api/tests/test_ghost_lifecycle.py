"""Ghost holds end to end: opened from stored decisions, ended exactly once,
expired on time, announced by durable webhooks, workable from the console."""
import json
import os
import secrets
import sys
import tempfile
import time
from datetime import datetime, timedelta, timezone

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
os.environ.setdefault("FABLE_DB_PATH", os.path.join(tempfile.mkdtemp(), "ghost-lifecycle.db"))
os.environ.setdefault("FABLE_SESSION_SECRET", "test-secret")

BANK, OTHER = "ghostbank", "ghostother"


def _session(inst: str = BANK, email: str | None = None) -> dict:
    from core import sessions

    return {"X-Fable-Session": sessions.issue(email or f"owner@{inst}.ng", inst)["token"]}


@pytest.fixture(scope="module")
def client():
    from fastapi.testclient import TestClient

    from core.db import cursor
    from core.tenancy import register_institution
    from core.utils import hash_password
    from main import app

    for inst in (BANK, OTHER):
        register_institution(inst, inst.title(), f"risk@{inst}.ng")
    with cursor() as cur:
        for email, role in ((f"owner@{BANK}.ng", "owner"), (f"analyst@{BANK}.ng", "analyst")):
            cur.execute("INSERT OR IGNORE INTO admins (email, institution_id, hashed_password, role, active) "
                        "VALUES (?, ?, ?, ?, 1)", (email, BANK, hash_password("x" * 12), role))
        cur.execute("INSERT OR IGNORE INTO webhooks (id, institution_id, url, secret, events, active) "
                    "VALUES ('wh_ghost', ?, 'https://hooks.example.ng/fable', 'whsec_test', ?, 1)",
                    (BANK, ",".join(__import__("services.webhooks", fromlist=["EVENTS"]).EVENTS)))
    return TestClient(app)


@pytest.fixture
def posts(monkeypatch):
    """Capture webhook deliveries instead of sending them."""
    from services import webhooks

    sent: list[dict] = []

    def fake_post(url, body, headers):
        sent.append(json.loads(body))
        return 200

    monkeypatch.setattr(webhooks, "validate_url", lambda url: url)
    monkeypatch.setattr(webhooks, "_post", fake_post)
    return sent


def _customer(ref: str, inst: str = BANK, balance: float = 2_000_000) -> str:
    from core import customers
    from services import accounts as ledger

    c = customers.ensure(inst, ref, kind="test", source="console")
    ledger.ensure_account(c["id"], inst, opening_balance=balance)
    return c["id"]


def _decision(user_id: str, action: str = "BLOCK", risk: float = 0.95, amount: float = 250_000,
              inst: str = BANK, signals: list | None = None) -> str:
    from core.db import cursor

    txid = f"txn_{secrets.token_hex(6)}"
    with cursor() as cur:
        cur.execute(
            "INSERT INTO transactions (id, user_id, amount, recipient_account, recipient_bank, institution_id, "
            "action_taken, risk_score, shield_signals, explanation, created_at) "
            "VALUES (?, ?, ?, '0123456789', 'Test Bank', ?, ?, ?, ?, 'Held because it looked like a scam.', ?)",
            (txid, user_id, amount, inst, action, risk, json.dumps(signals or ["new_recipient: first"]),
             datetime.now(timezone.utc).isoformat()),
        )
    return txid


def _outbox(event: str) -> list[dict]:
    from core.db import cursor

    with cursor() as cur:
        cur.execute("SELECT * FROM webhook_outbox WHERE event = ? ORDER BY id", (event,))
        return [dict(r) for r in cur.fetchall()]


def _rows_for(event: str, data_id: str) -> list[dict]:
    """This test's own outbox rows. The tests share one database, so other
    tests' rows can be in the outbox too; never assume it is empty or that the
    newest row is ours."""
    return [r for r in _outbox(event) if json.loads(r["payload"]).get("data", {}).get("id") == data_id]


def _data_id(body: bytes) -> str | None:
    return json.loads(body).get("data", {}).get("id")


def _drain():
    from services import webhooks

    time.sleep(0.2)  # let the emit's own background attempt finish first
    webhooks.drain()


# ── Opening a hold ───────────────────────────────────────────────────────────

def test_risk_comes_from_the_stored_decision_not_the_caller(client, posts):
    user = _customer("risk-source")
    txid = _decision(user, risk=0.95, signals=["device_anomaly: new", "location_anomaly: new"])
    res = client.post("/v1/ghost/create", headers=_session(), json={
        "user_id": user, "transaction_id": txid, "risk_score": 0.0, "signals": [], "explanation": "fine"})
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["risk_score"] == 0.95
    assert body["cooling_window_minutes"] == 15
    assert body["transaction_id"] == txid
    assert "device_anomaly: new" in body["signals"]
    _drain()
    created = [p for p in posts if p["type"] == "containment.created" and p["data"]["transaction_id"] == txid]
    assert created


def test_an_old_client_without_a_transaction_id_is_matched_to_its_block(client, posts):
    user = _customer("legacy-client")
    txid = _decision(user, amount=180_000)
    res = client.post("/v1/ghost/create", headers=_session(), json={
        "user_id": user, "risk_score": 0.1,
        "transaction": {"amount": 180_000, "recipient_account": "0123456789"}})
    assert res.status_code == 200, res.text
    assert res.json()["transaction_id"] == txid
    assert res.json()["risk_score"] == 0.95


def test_no_matching_decision_is_refused(client):
    user = _customer("no-match")
    res = client.post("/v1/ghost/create", headers=_session(), json={
        "user_id": user, "risk_score": 0.9, "transaction": {"amount": 1_000, "recipient_account": "9"}})
    assert res.status_code == 422


def test_only_blocks_can_be_held_unless_the_bank_allows_flags(client):
    from services import policy

    user = _customer("holdable")
    passed = _decision(user, action="PASS", risk=0.1)
    flagged = _decision(user, action="FLAG", risk=0.6)
    assert client.post(f"/v1/transactions/{passed}/hold", headers=_session(), json={"user_id": user}).status_code == 409
    assert client.post(f"/v1/transactions/{flagged}/hold", headers=_session(), json={"user_id": user}).status_code == 409
    policy.update(BANK, {"hold_on_flag": True}, "test")
    try:
        assert client.post(f"/v1/transactions/{flagged}/hold", headers=_session(),
                           json={"user_id": user}).status_code == 200
    finally:
        policy.update(BANK, {"hold_on_flag": False}, "test")


def test_holding_twice_returns_the_same_hold(client):
    user = _customer("idempotent")
    txid = _decision(user)
    a = client.post(f"/v1/transactions/{txid}/hold", headers=_session(), json={"user_id": user}).json()
    b = client.post("/v1/ghost/create", headers=_session(), json={"user_id": user, "transaction_id": txid}).json()
    assert a["ghost_id"] == b["ghost_id"]


def test_another_bank_cannot_hold_this_banks_decision(client):
    user = _customer("cross")
    other_user = _customer("cross-other", inst=OTHER)
    txid = _decision(user)
    res = client.post("/v1/ghost/create", headers=_session(OTHER), json={"user_id": other_user, "transaction_id": txid})
    assert res.status_code == 404


def test_a_client_cannot_mark_its_own_block_as_settled(client):
    user = _customer("status")
    txid = _decision(user)
    for status in ("completed", "released", "held", "expired"):
        res = client.post(f"/v1/transactions/{txid}/status", headers=_session(), json={"status": status})
        assert res.status_code == 409, status
    assert client.post(f"/v1/transactions/{txid}/status", headers=_session(),
                       json={"status": "cancelled"}).status_code == 200


# ── Ending a hold ────────────────────────────────────────────────────────────

def _hold(client, user: str, **kw) -> dict:
    txid = _decision(user, **kw)
    res = client.post(f"/v1/transactions/{txid}/hold", headers=_session(), json={"user_id": user})
    assert res.status_code == 200, res.text
    return res.json()


def _age(ghost_id: str, minutes: int = 30) -> None:
    from core.db import cursor

    past = datetime.now(timezone.utc) - timedelta(minutes=minutes)
    with cursor() as cur:
        cur.execute("UPDATE ghost_containers SET created_at = ?, expires_at = ? WHERE ghost_id = ?",
                    ((past - timedelta(minutes=15)).isoformat(), past.isoformat(), ghost_id))


def test_the_expiry_job_ends_a_hold_once_and_tells_everyone(client, posts):
    from core.db import cursor
    from main import register_jobs
    from services import scheduler

    register_jobs()
    user = _customer("expiry")
    hold = _hold(client, user)
    _age(hold["ghost_id"])
    scheduler.run_due(force=True)
    scheduler.run_due(force=True)   # running again changes nothing
    with cursor() as cur:
        cur.execute("SELECT status, resolved_by FROM ghost_containers WHERE ghost_id = ?", (hold["ghost_id"],))
        row = cur.fetchone()
        cur.execute("SELECT status FROM transactions WHERE id = ?", (hold["transaction_id"],))
        txn = cur.fetchone()
        cur.execute("SELECT COUNT(*) AS n FROM notifications WHERE reference = ? AND kind = 'containment'",
                    (hold["ghost_id"],))
        notes = cur.fetchone()["n"]
    assert row["status"] == "EXPIRED" and row["resolved_by"] == "expiry"
    assert txn["status"] == "expired"
    assert notes >= 1
    _drain()
    expired = [p for p in posts if p["type"] == "containment.expired" and p["data"]["ghost_id"] == hold["ghost_id"]]
    assert len(expired) == 1


def test_reading_a_hold_applies_its_expiry_even_if_the_job_is_late(client):
    user = _customer("lazy")
    hold = _hold(client, user)
    _age(hold["ghost_id"])
    res = client.get(f"/v1/ghost/{hold['ghost_id']}", headers=_session())
    assert res.json()["status"] == "EXPIRED"
    release = client.post(f"/v1/ghost/{hold['ghost_id']}/confirm", headers=_session(), json={"user_id": user})
    assert release.status_code == 410


def test_an_expired_hold_no_longer_reserves_the_balance(client):
    from services import accounts as ledger

    user = _customer("reserve", balance=500_000)
    hold = _hold(client, user, amount=300_000)
    assert ledger.get_balance(user, BANK)["available"] == 200_000
    _age(hold["ghost_id"])
    client.get(f"/v1/ghost/{hold['ghost_id']}", headers=_session())
    assert ledger.get_balance(user, BANK)["available"] == 500_000


def test_a_hold_ends_exactly_once(client):
    user = _customer("once")
    hold = _hold(client, user)
    assert client.post(f"/v1/ghost/{hold['ghost_id']}/cancel", headers=_session(), json={"user_id": user}).status_code == 200
    again = client.post(f"/v1/ghost/{hold['ghost_id']}/cancel", headers=_session(), json={"user_id": user})
    assert again.status_code == 409
    release = client.post(f"/v1/ghost/{hold['ghost_id']}/confirm", headers=_session(), json={"user_id": user})
    assert release.status_code == 409


def test_racing_resolutions_have_one_winner(client):
    from concurrent.futures import ThreadPoolExecutor

    from agents.ghost.account import _resolve

    user = _customer("race")
    hold = _hold(client, user)
    with ThreadPoolExecutor(max_workers=8) as pool:
        wins = list(pool.map(lambda s: _resolve(hold["ghost_id"], s, "test"), ["CANCELLED", "RELEASED"] * 4))
    assert sum(wins) == 1


def test_a_verified_release_sends_the_money_in_the_sandbox(client, posts):
    from agents.shield import stepup
    from services import accounts as ledger

    user = _customer("release", balance=1_000_000)
    hold = _hold(client, user, risk=0.6, amount=100_000)
    token = stepup.issue_token(user, "identity_check", "ghost_release", hold["ghost_id"],
                               factors={"passkey": None, "pin": None, "otp": None})["token"]
    res = client.post(f"/v1/ghost/{hold['ghost_id']}/confirm", headers=_session(),
                      json={"user_id": user, "stepup_token": token})
    assert res.status_code == 200, res.text
    assert ledger.get_balance(user, BANK)["balance"] == 900_000
    _drain()
    mine = [p for p in posts if p["data"].get("ghost_id") == hold["ghost_id"]]
    assert any(p["type"] == "containment.released" for p in mine)
    assert any(p["type"] == "containment.resolved" and p["data"]["outcome"] == "released" for p in mine)


# ── From the console ─────────────────────────────────────────────────────────

def test_staff_can_cancel_and_only_an_owner_with_a_note_can_release(client):
    analyst = _session(BANK, f"analyst@{BANK}.ng")
    owner = _session(BANK, f"owner@{BANK}.ng")
    user = _customer("staff")
    first = _hold(client, user)
    assert client.post(f"/v1/review/{first['transaction_id']}/hold/cancel", headers=analyst,
                       json={"note": "Customer called, not them"}).json()["status"] == "CANCELLED"

    second = _hold(client, user)
    path = f"/v1/review/{second['transaction_id']}/hold/release"
    assert client.post(path, headers=analyst, json={"note": "called the customer back"}).status_code == 403
    assert client.post(path, headers=owner, json={"note": "ok"}).status_code == 422
    done = client.post(path, headers=owner, json={"note": "Confirmed on a call to the number on file"})
    assert done.status_code == 200 and done.json()["status"] == "RELEASED"
    assert done.json()["resolved_by"] == f"staff:owner@{BANK}.ng"

    case = client.get(f"/v1/review/{second['transaction_id']}", headers=analyst).json()
    assert case["containment"]["status"] == "RELEASED"
    assert any(a["event_type"] == "containment.released" for a in case["activity"])


def test_another_banks_staff_cannot_touch_the_hold(client):
    user = _customer("staff-cross")
    hold = _hold(client, user)
    res = client.post(f"/v1/review/{hold['transaction_id']}/hold/cancel", headers=_session(OTHER), json={})
    assert res.status_code == 404


# ── The outbox survives failures and restarts ────────────────────────────────

def test_a_failed_delivery_is_retried_from_the_outbox(client, monkeypatch):
    from core.db import cursor
    from services import webhooks

    data_id = f"t-outbox-{secrets.token_hex(4)}"
    ours = []

    def fake_post(url, body, headers):
        # Decided by the event itself: this test's event fails on its first
        # attempt and lands on its second. Other tests' rows that the drain
        # also picks up are delivered and do not count.
        if _data_id(body) != data_id:
            return 200
        ours.append(1)
        return 503 if len(ours) == 1 else 200

    monkeypatch.setattr(webhooks, "validate_url", lambda url: url)
    monkeypatch.setattr(webhooks, "_post", fake_post)
    # Nothing in flight: write the row the way emit does, without the fast path.
    monkeypatch.setattr(webhooks._pool, "submit", lambda *a, **k: None)
    webhooks.emit(BANK, "case.resolved", {"id": data_id})
    [row] = _rows_for("case.resolved", data_id)
    assert row["status"] == "pending"

    webhooks.drain()
    with cursor() as cur:
        cur.execute("SELECT status, attempts, next_attempt_at FROM webhook_outbox WHERE id = ?", (row["id"],))
        after = cur.fetchone()
    assert after["status"] == "pending" and after["attempts"] == 1 and after["next_attempt_at"] > time.time()

    with cursor() as cur:   # the backoff has passed
        cur.execute("UPDATE webhook_outbox SET next_attempt_at = 0 WHERE id = ?", (row["id"],))
    webhooks.drain()
    with cursor() as cur:
        cur.execute("SELECT status, attempts FROM webhook_outbox WHERE id = ?", (row["id"],))
        final = cur.fetchone()
    assert final["status"] == "delivered" and final["attempts"] == 2 and len(ours) == 2


def test_retries_span_about_a_day_before_giving_up():
    from services import webhooks

    # The wait before try n+1 follows try n; the last try has no wait after it.
    span = sum(webhooks._backoff(n) for n in range(1, webhooks.MAX_ATTEMPTS))
    assert 20 * 3600 <= span <= 30 * 3600, span / 3600
    assert webhooks._backoff(1) == 30 and webhooks._backoff(30) == 6 * 3600


def test_a_delivery_stuck_mid_flight_is_picked_up_again(client, posts):
    from core.db import cursor
    from services import webhooks

    with cursor() as cur:
        cur.execute("INSERT INTO webhook_outbox (webhook_id, institution_id, event, event_id, payload, status, "
                    "claimed_at) VALUES ('wh_ghost', ?, 'case.resolved', 'evt_stuck', ?, 'sending', ?)",
                    (BANK, json.dumps({"id": "evt_stuck", "type": "case.resolved", "data": {}}), time.time() - 3600))
        stuck = cur.lastrowid
    webhooks.drain()
    with cursor() as cur:
        cur.execute("SELECT status FROM webhook_outbox WHERE id = ?", (stuck,))
        assert cur.fetchone()["status"] == "delivered"


def test_the_event_id_is_the_same_on_every_retry(client, monkeypatch):
    from services import webhooks

    data_id = f"same-id-{secrets.token_hex(4)}"
    bodies = []

    def fake_post(url, body, headers):
        if _data_id(body) != data_id:
            return 200  # another test's row the drain also picked up
        bodies.append(json.loads(body))
        return 500

    monkeypatch.setattr(webhooks, "validate_url", lambda url: url)
    monkeypatch.setattr(webhooks, "_post", fake_post)
    monkeypatch.setattr(webhooks._pool, "submit", lambda *a, **k: None)
    from core.db import cursor

    webhooks.emit(BANK, "case.resolved", {"id": data_id})
    [row] = _rows_for("case.resolved", data_id)
    for _ in range(3):
        with cursor() as cur:
            cur.execute("UPDATE webhook_outbox SET next_attempt_at = 0 WHERE id = ?", (row["id"],))
        webhooks.drain()
    assert len({b["id"] for b in bodies}) == 1 and len(bodies) == 3


# ── Scheduler and health ─────────────────────────────────────────────────────

def test_a_job_runs_once_per_interval_across_workers():
    from services import scheduler

    ran = []
    job = scheduler.Job("test_once", 3600, lambda: ran.append(1))
    scheduler.run_job(job, force=True)
    assert scheduler.run_job(job) is None and len(ran) == 1   # not due again yet


def test_health_reports_the_background_work(client):
    body = client.get("/health").json()
    for key in ("database", "scheduler", "webhook_outbox", "explainer", "warnings"):
        assert key in body
    assert body["database"]["healthy"] is True


# ── Asking the bank to release ───────────────────────────────────────────────

def test_a_customer_without_the_factors_can_ask_the_bank_to_release(client, posts):
    from core.db import cursor

    user = _customer("ask-bank")
    hold = _hold(client, user, signals=["device_anomaly: new", "location_anomaly: new"])
    req = client.post("/v1/stepup/requirement", headers=_session(), json={
        "user_id": user, "purpose": "ghost_release", "reference": hold["ghost_id"]}).json()
    assert req["steps"] is None and req["can_request_release"] is True

    res = client.post(f"/v1/ghost/{hold['ghost_id']}/request-release", headers=_session(), json={"user_id": user})
    assert res.status_code == 200, res.text
    assert res.json()["status"] == "RELEASE_REQUESTED"
    # The window is extended so staff have time to verify the customer.
    assert res.json()["expires_at"] > hold["expires_at"]
    with cursor() as cur:
        cur.execute("SELECT review_state FROM transactions WHERE id = ?", (hold["transaction_id"],))
        assert cur.fetchone()["review_state"] == "open"
    _drain()
    assert any(p["type"] == "containment.release_requested" and p["data"].get("ghost_id") == hold["ghost_id"]
               for p in posts)

    analyst = _session(BANK, f"analyst@{BANK}.ng")
    queue = client.get("/v1/review/queue?state=active", headers=analyst).json()["cases"]
    assert queue[0]["id"] == hold["transaction_id"] and queue[0]["hold_status"] == "RELEASE_REQUESTED"
    assert client.get("/v1/review/counts", headers=analyst).json()["release_requested"] >= 1

    owner = _session(BANK, f"owner@{BANK}.ng")
    done = client.post(f"/v1/review/{hold['transaction_id']}/hold/release", headers=owner,
                       json={"note": "Called the customer on the number on file; confirmed."})
    assert done.status_code == 200 and done.json()["status"] == "RELEASED"


def test_analysts_release_only_where_the_bank_allows_it(client):
    from services import policy

    analyst = _session(BANK, f"analyst@{BANK}.ng")
    user = _customer("analyst-release")
    hold = _hold(client, user)
    path = f"/v1/review/{hold['transaction_id']}/hold/release"
    note = {"note": "Customer confirmed at the branch with ID"}
    assert client.post(path, headers=analyst, json=note).status_code == 403
    policy.update(BANK, {"analysts_can_release": True}, "test")
    try:
        assert client.post(path, headers=analyst, json=note).json()["status"] == "RELEASED"
    finally:
        policy.update(BANK, {"analysts_can_release": False}, "test")


def test_a_long_stale_hold_expires_quietly(client, posts):
    from agents.ghost.account import sweep_expired
    from core.db import cursor

    user = _customer("stale")
    recent, stale = _hold(client, user), _hold(client, user)
    _age(recent["ghost_id"], minutes=10)
    _age(stale["ghost_id"], minutes=180)
    sweep_expired()
    _drain()
    ids = {p["data"].get("ghost_id") for p in posts if p["type"] == "containment.expired"}
    assert recent["ghost_id"] in ids and stale["ghost_id"] not in ids
    with cursor() as cur:
        cur.execute("SELECT status FROM ghost_containers WHERE ghost_id = ?", (stale["ghost_id"],))
        assert cur.fetchone()["status"] == "EXPIRED"
        cur.execute("SELECT COUNT(*) AS n FROM notifications WHERE reference = ? AND title LIKE '%not sent%'",
                    (stale["ghost_id"],))
        assert cur.fetchone()["n"] == 0
        cur.execute("SELECT COUNT(*) AS n FROM audit_log WHERE event_type = 'containment.expired' "
                    "AND payload LIKE ?", (f"%{stale['ghost_id']}%",))
        assert cur.fetchone()["n"] == 1


def test_the_legacy_match_window_is_a_setting(client, monkeypatch):
    from core import config
    from core.db import cursor

    user = _customer("match-window")
    txid = _decision(user, amount=77_000)
    old = (datetime.now(timezone.utc) - timedelta(minutes=30)).isoformat()
    with cursor() as cur:
        cur.execute("UPDATE transactions SET created_at = ? WHERE id = ?", (old, txid))
    body = {"user_id": user, "transaction": {"amount": 77_000, "recipient_account": "0123456789"}}
    monkeypatch.setattr(config, "GHOST_LEGACY_MATCH_MINUTES", 10)
    assert client.post("/v1/ghost/create", headers=_session(), json=body).status_code == 422
    monkeypatch.setattr(config, "GHOST_LEGACY_MATCH_MINUTES", 60)
    assert client.post("/v1/ghost/create", headers=_session(), json=body).json()["transaction_id"] == txid
