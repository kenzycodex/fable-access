"""Every decision stores a feature snapshot for a later per-customer model.

  * It holds every group of features listed for that model, from the values
    scoring used.
  * It never holds a name, account number, narration, exact GPS or IP address.
  * The analyst's label is read through decision_dataset, not copied.
  * It follows the customer's erasure and export.
"""
import json
import os
import secrets
import sys
import tempfile

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
os.environ.setdefault("FABLE_DB_PATH", os.path.join(tempfile.mkdtemp(), "features.db"))
os.environ.setdefault("FABLE_SESSION_SECRET", "test-secret")

BANK = "featurebank"
ACCOUNT, NAME, NARRATION = "0123456789", "ADAEZE OKAFOR", "urgent help abeg"


@pytest.fixture(scope="module")
def client():
    from fastapi.testclient import TestClient

    from core.tenancy import register_institution
    from main import app

    register_institution(BANK, "Feature Bank", "risk@feature.ng")
    return TestClient(app)


def _session() -> dict:
    from core import sessions

    return {"X-Fable-Session": sessions.issue(f"owner@{BANK}.ng", BANK)["token"]}


def _customer(ref: str) -> str:
    from core import customers
    from services import accounts as ledger

    user = customers.ensure(BANK, ref, kind="test", source="console")["id"]
    ledger.ensure_account(user, BANK, opening_balance=5_000_000)
    return user


def _decide(client, user: str, amount: float = 25_000) -> str:
    res = client.post("/v1/shield/analyze", headers=_session(), json={
        "user_id": user,
        "transaction": {"amount": amount, "recipient_account": ACCOUNT, "recipient_name": NAME,
                        "recipient_bank": "Access Bank", "narration": NARRATION, "channel": "mobile_app"},
        "device": {"fingerprint_id": "fp_feat", "ip": "102.89.44.55", "platform": "Android", "os": "Android 14",
                   "browser": "Chrome"},
        "context": {"latitude": 6.601234, "longitude": 3.351987, "city": "Ikeja", "country": "Nigeria",
                    "session_duration_seconds": 40, "time_to_submit_seconds": 12, "paste_detected": True,
                    "typing_speed_ms": 180, "client_timestamp": "2026-10-01T09:15:00+01:00",
                    "client_timezone": "Africa/Lagos"},
    })
    assert res.status_code == 200, res.text
    return res.json()["transaction_id"]


def _snapshot(txid: str) -> dict:
    from core.db import cursor

    with cursor() as cur:
        cur.execute("SELECT features FROM decision_features WHERE transaction_id = ?", (txid,))
        row = cur.fetchone()
    assert row, "no snapshot stored"
    return json.loads(row["features"])


def test_every_listed_feature_is_captured(client):
    user = _customer(f"f-{secrets.token_hex(3)}")
    first = _decide(client, user)
    second = _decide(client, user, amount=30_000)
    f = _snapshot(second)
    expected = {
        "amount": {"raw", "log", "ratio_to_average", "ratio_to_median", "zscore", "first_transfer",
                   "share_of_balance"},
        "time": {"hour", "hour_sin", "hour_cos", "day_of_week", "weekend", "public_holiday_fixed", "usual_hours"},
        "recipient": {"known", "times_paid_before", "days_since_first_paid", "days_since_last_paid", "bank",
                      "own_account"},
        "device": {"known", "trust_score", "times_seen", "platform", "os", "browser"},
        "location": {"same_city", "same_country", "distance_km_from_usual", "timezone_match"},
        "channel": {"channel", "usual_share"},
        "velocity": {"transfers_10m", "transfers_1h", "transfers_24h", "amount_24h"},
        "session": {"session_age_s", "time_to_submit_s", "review_s", "paste_detected", "typing_speed_ms"},
        "narration": {"scam_patterns"},
        "verification": {"recent_failed_stepups"},
        "context": {"baseline_source", "history_length", "tenure_days", "institution_id", "engine_version",
                    "engine_params_hash", "copilot_version", "ghost_version", "feature_version"},
        "outcome": {"decision", "risk_score"},
    }
    for group, keys in expected.items():
        assert keys <= set(f[group]), (group, keys - set(f[group]))
    # Computed the way scoring sees it: the device clock, and only earlier transfers.
    assert f["time"]["hour"] == 9 and f["time"]["day_of_week"] == 4 and f["time"]["public_holiday_fixed"] is True
    assert f["velocity"]["transfers_10m"] == 1, "the first transfer, not this one"
    assert f["amount"]["raw"] == 30_000 and f["context"]["baseline_source"] in ("population", "none")
    assert f["narration"]["scam_patterns"], "the urgency script matched"
    assert f["device"]["platform"] == "Android" and f["session"]["paste_detected"] is True
    assert first != second


def test_a_snapshot_holds_no_personal_identifiers(client):
    user = _customer(f"p-{secrets.token_hex(3)}")
    text = json.dumps(_snapshot(_decide(client, user)))
    for forbidden in (ACCOUNT, NAME, NARRATION, "102.89.44", "6.601234", "3.351987", "6.6012"):
        assert forbidden not in text, forbidden


def test_the_label_is_joined_not_copied(client):
    from core.db import cursor

    user = _customer(f"l-{secrets.token_hex(3)}")
    txid = _decide(client, user)
    with cursor() as cur:
        cur.execute("UPDATE transactions SET review_outcome = 'fraud' WHERE id = ?", (txid,))
        cur.execute("SELECT review_outcome, features FROM decision_dataset WHERE transaction_id = ?", (txid,))
        row = cur.fetchone()
    assert row["review_outcome"] == "fraud" and "fraud" not in row["features"]


def test_snapshots_follow_export_and_erasure(client):
    from core.db import cursor

    ref = f"e-{secrets.token_hex(3)}"
    user = _customer(ref)
    txid = _decide(client, user)
    exported = client.get(f"/v1/customers/{ref}/export", headers=_session()).json()
    assert [s["transaction_id"] for s in exported["snapshots"]] == [txid]
    alias = client.post(f"/v1/customers/{ref}/erase", headers=_session(), json={"confirm_reference": ref}).json()["alias"]
    with cursor() as cur:
        cur.execute("SELECT user_id FROM decision_features WHERE transaction_id = ?", (txid,))
        assert cur.fetchone()["user_id"] == alias


def test_a_failing_snapshot_never_touches_the_decision(client, monkeypatch):
    from agents.shield import features

    monkeypatch.setattr(features, "build", lambda *a, **k: (_ for _ in ()).throw(RuntimeError("boom")))
    user = _customer(f"x-{secrets.token_hex(3)}")
    assert _decide(client, user)
