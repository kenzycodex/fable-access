"""Each step-up tier needs exactly the factors it names, decided by the server.

Pins the fixes for:
  * a one-time code alone being minted as the top passkey_and_otp tier because
    the caller asked for that level;
  * a code being sent to whatever address the caller named;
  * a contact added after a hold (or only just added) counting as a factor
    that releases the hold;
  * step-up tokens stored in plain text;
  * a token minted without a reference satisfying every transfer;
  * the PIN-change endpoint checking the old PIN without counting failures;
  * passkeys accepted without user verification.
"""
import os
import sys
import tempfile
from datetime import datetime, timedelta, timezone

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
os.environ.setdefault("FABLE_DB_PATH", os.path.join(tempfile.mkdtemp(), "stepup-assurance.db"))
os.environ.setdefault("FABLE_SESSION_SECRET", "test-secret")

BANK = "assurebank"


def _session() -> dict:
    from core import sessions

    return {"X-Fable-Session": sessions.issue(f"owner@{BANK}.ng", BANK)["token"]}


@pytest.fixture(scope="module")
def client():
    from fastapi.testclient import TestClient

    from core.tenancy import register_institution
    from main import app

    register_institution(BANK, "Assure Bank", f"risk@{BANK}.ng")
    with TestClient(app, headers=_session()) as c:
        yield c


@pytest.fixture
def sent(monkeypatch):
    """Capture every email instead of sending it."""
    from agents.shield import stepup
    from services import mailer

    outbox: list[tuple[str, str, str]] = []

    def fake_send(to, subject, body, html=None, from_address=None):
        outbox.append((to, subject, body))
        return True

    monkeypatch.setattr(mailer, "send", fake_send)
    monkeypatch.setattr(stepup, "_deliver_otp_email",
                        lambda email, code: outbox.append((email, "code", code)) or True)
    return outbox


def _customer(ref: str) -> str:
    from core import customers

    return customers.ensure(BANK, ref, kind="test", source="console")["id"]


def _decision(user_id: str, action: str = "FLAG", risk: float = 0.6, signals: str = "[]") -> str:
    import secrets

    from core.db import cursor

    txid = f"txn_{secrets.token_hex(6)}"
    with cursor() as cur:
        cur.execute(
            "INSERT INTO transactions (id, user_id, amount, institution_id, action_taken, risk_score, shield_signals) "
            "VALUES (?, ?, 5000, ?, ?, ?, ?)",
            (txid, user_id, BANK, action, risk, signals),
        )
    return txid


def _hold(user_id: str, risk: float = 0.6, created: datetime | None = None) -> str:
    import secrets

    from core.db import cursor

    created = created or datetime.now(timezone.utc)
    gid = f"ghost_{secrets.token_hex(6)}"
    with cursor() as cur:
        cur.execute(
            "INSERT INTO ghost_containers (ghost_id, user_id, amount, status, cooling_window_minutes, risk_score, "
            "created_at, expires_at, institution_id, signals) VALUES (?, ?, 1000, 'HELD', 15, ?, ?, ?, ?, '[]')",
            (gid, user_id, risk, created.isoformat(), (created + timedelta(minutes=15)).isoformat(), BANK),
        )
    return gid


def _set_email(user_id: str, email: str, set_at: datetime | None) -> None:
    from core.db import cursor

    with cursor() as cur:
        cur.execute("INSERT INTO user_security (user_id, institution_id) VALUES (?, ?) ON CONFLICT DO NOTHING",
                    (user_id, BANK))
        cur.execute("UPDATE user_security SET contact_email = ?, contact_email_set_at = ? WHERE user_id = ?",
                    (email, set_at.isoformat() if set_at else None, user_id))


def _code_for(outbox, email) -> str:
    return [c for to, subject, c in outbox if to == email and subject == "code"][-1]


# ── Tiers ────────────────────────────────────────────────────────────────────

def test_level_for_factors_names_exactly_what_was_proved():
    from agents.shield.assurance import level_for_factors as f

    assert f({"otp"}, has_passkey=True) == "otp"
    assert f({"pin"}, has_passkey=True) == "pin"
    assert f({"passkey"}, has_passkey=True) == "passkey"
    assert f({"passkey", "otp"}, has_passkey=True) == "passkey_and_otp"
    assert f({"pin", "otp"}, has_passkey=True) == "pin"           # the device factor is required
    assert f({"pin", "otp"}, has_passkey=False) == "passkey_and_otp"
    assert f({"passkey", "pin", "otp"}, has_passkey=True) == "identity_check"


def test_a_code_alone_is_never_the_top_tier(client, sent):
    """otp/verify used to issue passkey_and_otp whenever the caller asked."""
    user = _customer("otp-only")
    _set_email(user, "otp-only@example.ng", None)
    txid = _decision(user)
    challenge = client.post("/v1/stepup/otp/send", json={
        "user_id": user, "purpose": "transfer", "reference": txid}).json()["challenge_id"]
    res = client.post("/v1/stepup/otp/verify", json={
        "user_id": user, "challenge_id": challenge, "code": _code_for(sent, "otp-only@example.ng"),
        "required_level": "passkey_and_otp"})
    assert res.status_code == 200, res.text
    assert res.json()["level"] == "otp"


def test_the_code_goes_only_to_the_registered_address(client, sent):
    user = _customer("dest")
    _set_email(user, "real@example.ng", None)
    res = client.post("/v1/stepup/otp/send", json={
        "user_id": user, "purpose": "transfer", "reference": _decision(user), "email": "attacker@evil.ng"})
    assert res.status_code == 200, res.text
    assert all(to != "attacker@evil.ng" for to, _, _ in sent)
    assert any(to == "real@example.ng" for to, _, _ in sent)


def test_sms_is_refused_honestly(client):
    user = _customer("sms")
    res = client.post("/v1/stepup/otp/send", json={
        "user_id": user, "purpose": "transfer", "reference": _decision(user), "channel": "sms"})
    assert res.status_code == 400
    assert res.json()["detail"]["error"] == "sms_unavailable"


def test_requirement_comes_from_the_stored_decision(client):
    """The caller's risk score and signals are ignored once a reference is given."""
    user = _customer("req")
    txid = _decision(user, action="FLAG", risk=0.6,
                     signals='["device_anomaly: new", "location_anomaly: new"]')
    res = client.post("/v1/stepup/requirement", json={
        "user_id": user, "purpose": "transfer", "reference": txid, "risk_score": 0.0, "signals": []})
    assert res.status_code == 200
    assert res.json()["level"] == "passkey_and_otp"
    assert res.json()["source"] == "stored_decision"


def test_proofs_must_be_bound_to_the_customers_own_decision(client):
    user = _customer("bind")
    assert client.post("/v1/stepup/pin/verify", json={
        "user_id": user, "pin": "1357", "purpose": "transfer"}).status_code == 422
    other = _customer("bind-other")
    foreign = _decision(other)
    assert client.post("/v1/stepup/pin/verify", json={
        "user_id": user, "pin": "1357", "purpose": "transfer", "reference": foreign}).status_code == 404


def test_a_token_for_one_transfer_cannot_approve_another(client):
    from core import security

    user = _customer("one-token")
    security.set_pin(user, "1357")
    first, second = _decision(user), _decision(user)
    token = client.post("/v1/stepup/pin/verify", json={
        "user_id": user, "pin": "1357", "purpose": "transfer", "reference": first}).json()["token"]
    res = client.post(f"/v1/transactions/{second}/approve", json={"user_id": user, "stepup_token": token})
    assert res.status_code == 401


def test_tokens_are_stored_hashed_and_spent_once(client):
    from core import security
    from core.db import cursor

    user = _customer("hashed")
    security.set_pin(user, "1357")
    txid = _decision(user)
    token = client.post("/v1/stepup/pin/verify", json={
        "user_id": user, "pin": "1357", "purpose": "transfer", "reference": txid}).json()["token"]
    with cursor() as cur:
        cur.execute("SELECT token FROM stepup_tokens WHERE user_id = ?", (user,))
        stored = [r["token"] for r in cur.fetchall()]
    assert token not in stored and all(s.startswith("h:") for s in stored)

    from agents.shield import stepup

    assert stepup.consume_token(token) is True
    assert stepup.consume_token(token) is False


def test_plaintext_tokens_are_hashed_in_place_by_the_migration():
    import hashlib

    from core import db
    from core.db import cursor

    with cursor() as cur:
        cur.execute("INSERT INTO stepup_tokens (token, user_id, level, expires_at) "
                    "VALUES ('su_legacy_token', 'cus_x', 'pin', '2999-01-01T00:00:00+00:00')")
    db._migrate(db.get_conn())
    with cursor() as cur:
        cur.execute("SELECT token FROM stepup_tokens WHERE user_id = 'cus_x'")
        assert cur.fetchone()["token"] == "h:" + hashlib.sha256(b"su_legacy_token").hexdigest()


# ── Holds: factors set up after the hold do not release it ──────────────────

def test_a_pin_set_after_the_hold_cannot_release_it(client):
    from core import security

    user = _customer("late-pin")
    gid = _hold(user, risk=0.3, created=datetime.now(timezone.utc) - timedelta(minutes=5))
    security.set_pin(user, "1357")   # after the hold
    token = client.post("/v1/stepup/pin/verify", json={
        "user_id": user, "pin": "1357", "purpose": "ghost_release", "reference": gid}).json()["token"]
    # Release tier for a low-risk hold is one above "pin": a PIN token is short
    # anyway, so go through the composed check, which must refuse the late PIN.
    res = client.post("/v1/stepup/identity-check", json={
        "user_id": user, "purpose": "ghost_release", "reference": gid, "pin_token": token})
    assert res.status_code == 400
    assert "pin" in res.json()["detail"]["not_counted"]


def test_an_email_added_after_the_hold_does_not_count(client, sent):
    from core import security

    user = _customer("late-email")
    security.set_pin(user, "1357")
    long_ago = datetime.now(timezone.utc) - timedelta(days=3)
    from core.db import cursor

    with cursor() as cur:
        cur.execute("UPDATE user_security SET pin_set_at = ? WHERE user_id = ?", (long_ago.isoformat(), user))
    gid = _hold(user, risk=0.6, created=datetime.now(timezone.utc) - timedelta(minutes=5))
    _set_email(user, "late@example.ng", datetime.now(timezone.utc))   # after the hold

    pin_token = client.post("/v1/stepup/pin/verify", json={
        "user_id": user, "pin": "1357", "purpose": "ghost_release", "reference": gid}).json()["token"]
    challenge = client.post("/v1/stepup/otp/send", json={
        "user_id": user, "purpose": "ghost_release", "reference": gid}).json()["challenge_id"]
    otp_token = client.post("/v1/stepup/otp/verify", json={
        "user_id": user, "challenge_id": challenge, "code": _code_for(sent, "late@example.ng")}).json()["token"]
    res = client.post("/v1/stepup/identity-check", json={
        "user_id": user, "purpose": "ghost_release", "reference": gid,
        "pin_token": pin_token, "otp_token": otp_token})
    assert res.status_code == 400
    assert res.json()["detail"]["not_counted"] == ["otp"]


def test_a_recently_changed_email_does_not_count_in_live_mode(client, sent, monkeypatch):
    from agents.shield import stepup
    from core import config

    monkeypatch.setattr(config, "CONTACT_SETTLE_HOURS", 24)
    user = _customer("settle")
    _set_email(user, "settle@example.ng", datetime.now(timezone.utc) - timedelta(hours=2))
    hold_time = datetime.now(timezone.utc) - timedelta(minutes=1)
    from core.db import cursor

    with cursor() as cur:
        cur.execute("UPDATE institutions SET mode = 'live' WHERE institution_id = ?", (BANK,))
    try:
        ok, late = stepup.factors_predate({"otp": stepup.factor_enrolled_at(user, "otp")}, hold_time, user)
        assert not ok and late == ["otp"]
    finally:
        with cursor() as cur:
            cur.execute("UPDATE institutions SET mode = 'sandbox' WHERE institution_id = ?", (BANK,))


def test_release_refuses_a_token_whose_factor_postdates_the_hold():
    from agents.ghost.account import StepUpRequired, release_ghost
    from agents.shield import stepup

    user = _customer("release-late")
    gid = _hold(user, risk=0.1, created=datetime.now(timezone.utc) - timedelta(minutes=5))
    token = stepup.issue_token(user, "passkey", "ghost_release", gid,
                               factors={"passkey": datetime.now(timezone.utc).isoformat()})["token"]
    with pytest.raises(StepUpRequired):
        release_ghost(gid, user, token)


# ── Contact changes ──────────────────────────────────────────────────────────

def test_a_new_email_needs_the_pin_and_its_own_code_and_tells_the_old_one(client, sent):
    from core import security

    user = _customer("contact")
    security.set_pin(user, "1357")
    _set_email(user, "old@example.ng", datetime.now(timezone.utc) - timedelta(days=30))

    refused = client.post(f"/v1/accounts/{user}/security/contact", json={"email": "new@example.ng"})
    assert refused.status_code == 400

    started = client.post(f"/v1/accounts/{user}/security/contact",
                          json={"email": "new@example.ng", "current_pin": "1357"})
    assert started.status_code == 200, started.text
    body = started.json()
    assert body["pending_email"] and body["verification"]["challenge_id"]
    assert security.get_contact(user)["email"] == "old@example.ng"   # not yet in force

    code = _code_for(sent, "new@example.ng")
    confirmed = client.post(f"/v1/accounts/{user}/security/contact/verify",
                            json={"challenge_id": body["verification"]["challenge_id"], "code": code})
    assert confirmed.status_code == 200, confirmed.text
    assert security.get_contact(user)["email"] == "new@example.ng"
    assert any(to == "old@example.ng" and "changed" in subject.lower() for to, subject, _ in sent)


def test_a_contact_verification_code_cannot_be_used_as_a_transfer_factor(client, sent):
    user = _customer("cv-misuse")
    started = client.post(f"/v1/accounts/{user}/security/contact", json={"email": "cv@example.ng"})
    assert started.status_code == 200, started.text
    challenge = started.json()["verification"]["challenge_id"]
    res = client.post("/v1/stepup/otp/verify", json={
        "user_id": user, "challenge_id": challenge, "code": _code_for(sent, "cv@example.ng")})
    assert res.status_code == 400


# ── PIN change counts towards the lock ───────────────────────────────────────

def test_pin_change_wrong_guesses_lock_the_pin(client, monkeypatch):
    from core import config, security

    monkeypatch.setattr(config, "PIN_MAX_ATTEMPTS", 3)
    user = _customer("pin-oracle")
    security.set_pin(user, "1357")
    for guess in ("0000", "1111", "2222"):
        client.post(f"/v1/accounts/{user}/security/pin", json={"pin": "2468", "current_pin": guess})
    assert security.status(user)["pin_locked"] is True
    # The right PIN is refused while locked, on both paths.
    res = client.post(f"/v1/accounts/{user}/security/pin", json={"pin": "2468", "current_pin": "1357"})
    assert res.status_code == 400 and "Too many" in res.json()["detail"]


def test_pin_change_is_notified(client, sent):
    from core import security

    user = _customer("pin-notify")
    _set_email(user, "pn@example.ng", None)
    # First PIN: email exists, so the email factor must be proved via a token.
    from agents.shield import stepup

    token = stepup.issue_token(user, "otp", "security_change", None, factors={"otp": None})["token"]
    res = client.post(f"/v1/accounts/{user}/security/pin", json={"pin": "1357", "stepup_token": token})
    assert res.status_code == 200, res.text
    assert any(to == "pn@example.ng" and "PIN" in subject for to, subject, _ in sent)


# ── WebAuthn user verification ───────────────────────────────────────────────

def test_passkey_options_require_user_verification():
    from agents.shield import stepup

    user = _customer("uv")
    reg = stepup.begin_registration(user, "UV", BANK)
    assert reg["options"]["authenticatorSelection"]["userVerification"] == "required"
