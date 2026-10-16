"""The tenancy guard and the route must read the same body.

The guard used to look for the lower-case string "json" in the Content-Type
before reading the body, while FastAPI lower-cases the media type before
deciding. `application/JSON` therefore reached the route as JSON, carrying a
customer the guard had never checked, and a Bank A credential could act on a
Bank B customer through every /v1/stepup route.

Each test here sends Alpha's credential at Beta's customer, dressed up one way
or another, and expects nothing to happen to Beta.
"""
import json
import os
import sys
import tempfile

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
os.environ.setdefault("FABLE_DB_PATH", os.path.join(tempfile.mkdtemp(), "body-parsing.db"))
os.environ.setdefault("FABLE_SESSION_SECRET", "test-secret")

A, B = "bodyalpha", "bodybeta"


def _session(inst: str) -> dict:
    from core import sessions

    return {"X-Fable-Session": sessions.issue(f"owner@{inst}.ng", inst)["token"]}


@pytest.fixture(scope="module")
def world():
    from fastapi.testclient import TestClient

    from core import customers, security
    from core.tenancy import register_institution
    from main import app

    register_institution(A, "Body Alpha", "risk@bodyalpha.ng")
    register_institution(B, "Body Beta", "risk@bodybeta.ng")
    a = customers.create(A, "a-1", kind="test", source="console", display_name="Alpha customer")
    b = customers.create(B, "b-1", kind="test", source="console", display_name="Beta customer")
    security.set_pin(b["id"], "2580")
    return {"client": TestClient(app), "a": a, "b": b}


def _beta_untouched(b_id: str) -> None:
    from core.db import cursor

    with cursor() as cur:
        cur.execute("SELECT failed_attempts FROM user_security WHERE user_id = ?", (b_id,))
        assert (cur.fetchone()["failed_attempts"] or 0) == 0
        cur.execute("SELECT COUNT(*) AS n FROM stepup_tokens WHERE user_id = ?", (b_id,))
        assert cur.fetchone()["n"] == 0
        cur.execute("SELECT COUNT(*) AS n FROM stepup_challenges WHERE user_id = ?", (b_id,))
        assert cur.fetchone()["n"] == 0


CONTENT_TYPES = [
    "application/JSON",
    "Application/Json",
    "APPLICATION/JSON",
    "application/json; charset=utf-8",
    "application/JSON;charset=UTF-8",
    "application/vnd.fable+json",
    "text/plain",
    "application/octet-stream",
]


@pytest.mark.parametrize("content_type", CONTENT_TYPES)
def test_any_content_type_is_checked(world, content_type):
    c, b = world["client"], world["b"]
    headers = {**_session(A), "Content-Type": content_type}
    for path, body in (
        ("/v1/stepup/pin/verify", {"user_id": b["id"], "pin": "0000"}),
        ("/v1/stepup/requirement", {"user_id": b["id"], "risk_score": 0.9, "action": "BLOCK"}),
        ("/v1/stepup/passkey/register/begin", {"user_id": b["id"], "display_name": "x"}),
        ("/v1/stepup/otp/send", {"user_id": b["id"]}),
    ):
        res = c.post(path, content=json.dumps(body), headers=headers)
        assert res.status_code in (404, 415, 422), (content_type, path, res.status_code, res.text)
    _beta_untouched(b["id"])


def test_missing_content_type_is_checked(world):
    c, b = world["client"], world["b"]
    res = c.post("/v1/stepup/pin/verify", content=json.dumps({"user_id": b["id"], "pin": "0000"}),
                 headers=_session(A))
    assert res.status_code in (404, 415, 422)
    _beta_untouched(b["id"])


def test_form_encoded_body_is_refused(world):
    c, b = world["client"], world["b"]
    res = c.post("/v1/stepup/pin/verify", data={"user_id": b["id"], "pin": "0000"}, headers=_session(A))
    assert res.status_code in (404, 415, 422)
    _beta_untouched(b["id"])


def test_non_object_json_body_is_refused(world):
    c, b = world["client"], world["b"]
    res = c.post("/v1/stepup/pin/verify", content=json.dumps([{"user_id": b["id"]}]),
                 headers={**_session(A), "Content-Type": "application/json"})
    assert res.status_code == 422


def test_duplicate_keys_resolve_like_the_route(world):
    """json.loads keeps the last duplicate; the guard and route share one parse."""
    c, a, b = world["client"], world["a"], world["b"]
    raw = '{"user_id": "%s", "user_id": "%s", "pin": "0000"}' % (a["id"], b["id"])
    res = c.post("/v1/stepup/pin/verify", content=raw,
                 headers={**_session(A), "Content-Type": "application/JSON"})
    assert res.status_code == 404
    _beta_untouched(b["id"])


def test_query_string_customer_must_match(world):
    c, a, b = world["client"], world["a"], world["b"]
    res = c.get(f"/v1/accounts/{a['id']}/security?user_id={b['id']}", headers=_session(A))
    assert res.status_code in (400, 404)
    ok = c.get(f"/v1/accounts/{a['id']}/security?user_id={a['id']}", headers=_session(A))
    assert ok.status_code == 200


def test_path_and_body_must_name_the_same_customer(world):
    c, a = world["client"], world["a"]
    from core import customers

    other = customers.create(A, "a-2", kind="test", source="console", display_name="Second")
    res = c.post(f"/v1/accounts/{a['id']}/security/contact",
                 json={"user_id": other["id"], "email": "x@y.ng"}, headers=_session(A))
    assert res.status_code == 400


def test_body_ids_of_another_bank_are_not_found(world):
    """A transaction or hold named in the body is checked like one in the path."""
    from core.db import cursor

    c, a, b = world["client"], world["a"], world["b"]
    with cursor() as cur:
        cur.execute(
            "INSERT INTO transactions (id, user_id, amount, institution_id, action_taken) "
            "VALUES ('txn_beta_body', ?, 100, ?, 'BLOCK')", (b["id"], B))
    res = c.post("/v1/ghost/create", headers=_session(A), json={
        "user_id": a["id"], "transaction_id": "txn_beta_body", "risk_score": 0.1,
        "transaction": {"amount": 100, "recipient_account": "0123456789"},
    })
    assert res.status_code == 404


def test_own_customer_still_works_with_odd_casing(world):
    """The fix must not break a caller that just spells the header differently."""
    c, a = world["client"], world["a"]
    res = c.post("/v1/stepup/requirement",
                 content=json.dumps({"user_id": a["id"], "risk_score": 0.6, "action": "FLAG"}),
                 headers={**_session(A), "Content-Type": "application/JSON"})
    assert res.status_code == 200, res.text
