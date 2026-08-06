"""Pins the decision boundary.

There were no tests. Every finding the audit turned up would have been caught by
a single assertion here, so these are chosen for that: each one pins a bug that
actually shipped, rather than testing that Python works.

    pytest api/tests -q
"""
import os
import sys
import tempfile
from datetime import datetime, timedelta, timezone

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

# Pin the tuning these assertions were written against.
#
# These tests exercise the scoring *code*, not whatever a given deployment has
# in its .env. Without this they inherit the server's live weights, so tuning
# the thresholds on one box "breaks" the suite everywhere and the failure says
# nothing about the code. Set before any Fable module is imported, because
# config reads the environment at import time.
#
# Note the deliberate consequence: a deployment can tune itself out of these
# guarantees and the suite will not notice. That is what the separate
# `test_deployment_tuning_is_not_reckless` check below is for.
_PINNED = {
    "FABLE_DB_PATH": os.path.join(tempfile.mkdtemp(), "test.db"),
    "FABLE_SESSION_SECRET": "test-secret",
    "SMTP_USERNAME": "",
    "FABLE_W_NEW_RECIPIENT": "0.14",
    "FABLE_W_TIME_ANOMALY": "0.12",
    "FABLE_W_DEVICE_ANOMALY": "0.08",
    "FABLE_W_LOCATION_CITY": "0.06",
    "FABLE_CHANNEL_MOBILE_APP": "0.12",
    "FABLE_CHANNEL_USSD": "0.12",
    "FABLE_TENURE_DISCOUNT_MAX": "0.08",
    "FABLE_TENURE_FULL_AT": "120",
}
_LIVE_ENV = {k: os.environ.get(k) for k in _PINNED}
os.environ.update(_PINNED)


@pytest.fixture(scope="module")
def bank():
    """One seeded institution, reused across the module."""
    from tenancy import register_institution
    from agents.copilot.demo_customers import seed_institution

    register_institution("testbank", "Test Bank", "risk@test.ng")
    seed_institution("testbank", days=90)
    return "testbank"


CTX = {"client_timestamp": "2026-08-06T14:30:00+01:00"}


def score(uid, amount, institution, **over):
    from agents.shield.analyzer import analyze_transaction

    txn = {"amount": amount, "recipient_account": "0999999999",
           "narration": "", "channel": "mobile_app", **over}
    return analyze_transaction(uid, txn, {}, CTX, institution)


# --- D-4: amount bounds --------------------------------------------------

@pytest.mark.parametrize("amount", [-5000, 0, 9e12])
def test_amount_out_of_range_is_rejected(amount):
    """Zero and negative amounts tripped no signal, scored 0.0, passed the funds
    check because -1000 > available is false, and reached debit as a PASS."""
    from pydantic import ValidationError
    from models.schemas import Transaction

    with pytest.raises(ValidationError):
        Transaction(amount=amount, recipient_account="0123456789")


def test_currency_is_pinned_to_naira():
    """A USD transfer of 100 was scored and debited as ₦100."""
    from pydantic import ValidationError
    from models.schemas import Transaction

    with pytest.raises(ValidationError):
        Transaction(amount=1000, currency="USD", recipient_account="0123456789")


# --- D-1: NIP codes are rail-sourced only --------------------------------

def test_client_supplied_nip_code_is_ignored():
    """The heaviest signal in the pipeline (code 34 forces 0.95) was readable
    straight from the request body, so a caller could force a block."""
    from agents.shield.analyzer import _rail_nip_code

    assert _rail_nip_code({"nip_response_code": "34"}) is None
    assert _rail_nip_code({"nip_response_code": "34", "nip_source": "rail"}) == "34"


# --- D-3: the velocity window is a window --------------------------------

def test_velocity_window_does_not_swallow_the_whole_day():
    """created_at is written with a 'T' and the cutoff with a space; compared as
    strings, 'T' sorts after ' ', so every row sharing the date matched."""
    import sqlite3

    conn = sqlite3.connect(":memory:")
    conn.execute("CREATE TABLE t (created_at TEXT)")
    now = datetime.now(timezone.utc)
    conn.executemany(
        "INSERT INTO t VALUES (?)",
        [((now - timedelta(minutes=m)).isoformat(),) for m in (1, 5, 9, 30, 240)],
    )
    sql = "SELECT COUNT(*) FROM t WHERE datetime(created_at) >= datetime('now', '-10 minutes')"
    assert conn.execute(sql).fetchone()[0] == 3


# --- I-2: keyword matching respects word boundaries ----------------------

@pytest.mark.parametrize("narration", ["premium payment", "maximum load", "minimum balance", "dada shop"])
def test_scam_keywords_do_not_match_inside_words(narration):
    """'mum' fired inside premium/maximum/minimum, 'dad' inside dada."""
    from agents.shield.patterns import match_scam_pattern

    assert match_scam_pattern(narration) is None


@pytest.mark.parametrize("narration", ["abeg send am now", "mum needs help urgent"])
def test_real_scam_scripts_still_match(narration):
    from agents.shield.patterns import match_scam_pattern

    assert match_scam_pattern(narration) is not None


# --- B-1 / the whole premise: per-customer baselines ---------------------

def test_same_amount_opposite_verdicts_for_different_customers(bank):
    """The product's central claim. A trader's routine transfer must clear while
    the same amount stops a student, and this is the assertion that would fail
    first if baselines ever stopped being per-customer."""
    trader = score("testbank_tunde", 300_000, bank)
    student = score("testbank_chioma", 300_000, bank)

    assert trader["action"] == "PASS"
    assert student["action"] == "BLOCK"
    assert student["risk_score"] > trader["risk_score"]


def test_variance_aware_scoring_tolerates_an_erratic_customer(bank):
    """A raw multiple punished consistency: the trader's ordinary swing between
    ₦80k and ₦400k read as an anomaly on every transfer."""
    assert score("testbank_tunde", 600_000, bank)["action"] == "PASS"
    assert score("testbank_tunde", 2_000_000, bank)["action"] in {"FLAG", "BLOCK"}


def test_tenure_discount_applies_and_is_capped(bank):
    """Past cold start the friction model was flat: 3 clean transfers and 500
    scored identically."""
    from agents.copilot.baseline import get_user_baseline, TENURE_DISCOUNT_MAX

    b = get_user_baseline("testbank_chioma")
    assert 0 < b["tenure_discount"] <= TENURE_DISCOUNT_MAX


# --- FR-1 / SEC-1: containment cannot be self-satisfied ------------------

def test_release_requires_a_factor_that_predates_the_hold():
    """Bootstrapping the first factor is allowed, and the composed tier counts
    whatever exists — so an attacker set a PIN on the release screen and used it
    to release the money."""
    from routers.stepup import _predates

    hold = datetime(2026, 8, 6, 12, 0, tzinfo=timezone.utc)
    assert _predates("2026-08-06T11:00:00+00:00", hold) is True
    assert _predates("2026-08-06T12:30:00+00:00", hold) is False


def test_otp_is_never_returned_in_the_response():
    """debug_code was attached whenever delivery failed, and with no SMS
    provider wired delivery fails by default — handing the out-of-band factor to
    whoever held the session."""
    import config

    assert config.ALLOW_DEBUG_OTP is False


# --- S0-4: tenant isolation ----------------------------------------------

def test_unscoped_tenant_query_raises_rather_than_aggregating():
    """An empty clause turned a per-tenant rollup into a platform-wide one, so
    simply omitting the parameter returned every bank's numbers together."""
    from intelligence.context import tenant_clause, UnscopedQuery

    with pytest.raises(UnscopedQuery):
        tenant_clause(None)
    assert tenant_clause("testbank")[1] == ["testbank"]


def test_deployment_tuning_is_not_reckless():
    """Guards the tuning this box is actually running, not the pinned defaults.

    The rest of the suite pins its own weights so it tests the code. This one
    reads the deployment's real .env, because tuning is where the damage
    happens: a friction-reduction pass once took the tenure discount to 0.12
    and full tenure to 60 transactions, which let a trader move 8x his normal
    — twenty standard deviations out — unchallenged.

    Deliberately loose. It does not dictate a policy, it refuses the obviously
    dangerous end of the range.
    """
    def env(name, default):
        try:
            return float(_LIVE_ENV.get(name) or default)
        except (TypeError, ValueError):
            return float(default)

    tenure_max = env("FABLE_TENURE_DISCOUNT_MAX", 0.08)
    new_recipient = env("FABLE_W_NEW_RECIPIENT", 0.14)

    # A discount worth more than a new-recipient signal can cancel one outright.
    assert tenure_max <= 0.10, (
        f"FABLE_TENURE_DISCOUNT_MAX={tenure_max} is large enough to erase a "
        "whole signal on its own."
    )
    assert new_recipient >= 0.10, (
        f"FABLE_W_NEW_RECIPIENT={new_recipient} is below the point where a "
        "first-time payee meaningfully registers, and that is the core scenario."
    )


def test_session_token_fails_closed(monkeypatch):
    """Every rejection path, including a tampered institution."""
    import base64
    import json
    import sessions

    good = sessions.issue("a@b.c", "testbank")["token"]
    assert sessions.verify(good)["inst"] == "testbank"

    payload, sig = good.split(".")
    forged = base64.urlsafe_b64encode(
        json.dumps({"sub": "x", "inst": "other_bank", "exp": 9999999999}).encode()
    ).decode().rstrip("=")

    for bad in (None, "", "garbage", f"{forged}.{sig}", f"{payload}.{'A' * 43}"):
        with pytest.raises(sessions.SessionError):
            sessions.verify(bad)
