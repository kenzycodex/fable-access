"""Saved recipients in the sandbox app come from the customer's own history,
are masked, and can only be used by the customer they were issued to."""
import os
import sys

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
os.environ.setdefault("FABLE_SESSION_SECRET", "test-secret")

from tests.helpers import PROFILES, add_customer, add_decisions, ref, seed_bank  # noqa: E402

BANK, OTHER = "recipbank", "recipother"


def _session(inst: str) -> dict:
    from core import sessions

    return {"X-Fable-Session": sessions.issue(f"owner@{inst}.ng", inst)["token"]}


@pytest.fixture(scope="module")
def client():
    from fastapi.testclient import TestClient

    from main import app

    seed_bank(BANK)  # tunde and chioma, with history and some blocked transfers
    seed_bank(OTHER, keys=("ada",))
    return TestClient(app)


def _recipients(client, who: str, inst: str = BANK):
    return client.get(f"/v1/sandbox/recipients/{ref(BANK, who)}", headers=_session(inst))


def test_recipients_are_the_customers_own_and_masked(client):
    r = _recipients(client, "tunde")
    assert r.status_code == 200, r.text
    body = r.json()["recipients"]
    assert body, "tunde has history, so has saved recipients"
    tunde = {a for a, _ in PROFILES["tunde"]["recipients"]}
    chioma = {a for a, _ in PROFILES["chioma"]["recipients"]}
    shown = {x["account_last4"][-4:] for x in body}
    assert shown <= {a[-4:] for a in tunde}
    assert not shown & {a[-4:] for a in chioma - tunde}, "another customer's recipients leaked"
    raw = r.text
    for account in tunde | chioma:
        assert account not in raw, "a full account number reached the browser"


def test_blocked_transfers_never_become_saved_recipients(client):
    from core.db import cursor
    from tests.helpers import uid

    with cursor() as cur:
        cur.execute("SELECT recipient_account FROM transactions WHERE user_id = ? AND action_taken = 'BLOCK'",
                    (uid(BANK, "chioma"),))
        blocked = {r[0][-4:] for r in cur.fetchall()}
    assert blocked
    shown = {x["account_last4"][-4:] for x in _recipients(client, "chioma").json()["recipients"]}
    assert not shown & blocked


def test_a_token_works_only_for_the_customer_it_was_issued_to(client):
    token = _recipients(client, "tunde").json()["recipients"][0]["token"]
    transfer = {"amount": 2_000, "recipient_token": token, "narration": "rent", "channel": "mobile_app"}

    mine = client.post("/v1/shield/analyze", headers=_session(BANK),
                       json={"user_id": ref(BANK, "tunde"), "transaction": transfer})
    assert mine.status_code == 200, mine.text

    theirs = client.post("/v1/shield/analyze", headers=_session(BANK),
                         json={"user_id": ref(BANK, "chioma"), "transaction": transfer})
    assert theirs.status_code == 422 and "another customer" in theirs.json()["detail"]

    forged = client.post("/v1/shield/analyze", headers=_session(BANK),
                         json={"user_id": ref(BANK, "tunde"), "transaction": {**transfer, "recipient_token": token[:-2] + "xx"}})
    assert forged.status_code == 422


def test_another_bank_and_real_customers_are_not_served(client):
    assert _recipients(client, "tunde", inst=OTHER).status_code == 404
    add_customer(BANK, "ada", kind="real")
    add_decisions(BANK, "ada", count=1)
    assert _recipients(client, "ada").status_code == 404


def test_a_transfer_needs_an_account_or_a_token(client):
    r = client.post("/v1/shield/analyze", headers=_session(BANK),
                    json={"user_id": ref(BANK, "tunde"), "transaction": {"amount": 1_000, "channel": "mobile_app"}})
    assert r.status_code == 422
