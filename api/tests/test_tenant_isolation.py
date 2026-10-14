"""One bank can never reach another bank's data.

Each test pins one rule of the tenancy model (core/tenancy.py):

  * a bank is identified by its credential, never by a name in the request;
  * no credential is a 401, on every customer endpoint;
  * another bank's customer, hold or transaction is "not found", whatever
    credential is used, so ids cannot be probed;
  * two banks may use the same customer reference without sharing anything;
  * a live bank's customers are reachable only with its API key;
  * a suspended bank is refused everywhere.
"""
import os
import sys
import tempfile

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
os.environ.setdefault("FABLE_DB_PATH", os.path.join(tempfile.mkdtemp(), "isolation.db"))
os.environ.setdefault("FABLE_SESSION_SECRET", "test-secret")
os.environ.setdefault("SMTP_USERNAME", "")

A, B = "alphabank", "betabank"
SHARED_REF = "10293"  # both banks have a customer they call 10293


def _session(inst: str, email: str | None = None) -> dict:
    from core import sessions

    return {"X-Fable-Session": sessions.issue(email or f"owner@{inst}.ng", inst)["token"]}


def _key(inst: str) -> str:
    from core import apikeys
    from core.db import cursor

    raw = apikeys.generate()
    with cursor() as cur:
        cur.execute("UPDATE api_keys SET is_active = 0 WHERE institution_id = ?", (inst,))
        apikeys.insert(cur, raw, inst, inst.title(), f"owner@{inst}.ng")
    return raw


def _transfer(amount: float = 3_000, **extra) -> dict:
    return {
        "user_id": SHARED_REF,
        "transaction": {"amount": amount, "recipient_id": "r1", "recipient_account": "0123456789",
                        "recipient_bank": "Test Bank", "recipient_name": "Test Person",
                        "narration": "food", "channel": "mobile_app"},
        **extra,
    }


@pytest.fixture(scope="module")
def world():
    from fastapi.testclient import TestClient

    from core import customers
    from core.db import cursor
    from core.tenancy import register_institution
    from main import app

    register_institution(A, "Alpha Bank", "risk@alphabank.ng")
    register_institution(B, "Beta Bank", "risk@betabank.ng")
    for inst in (A, B):
        customers.create(inst, SHARED_REF, kind="test", source="console", display_name=f"{inst} customer")
    keys = {A: _key(A), B: _key(B)}
    client = TestClient(app)

    # Give Alpha's customer money in the sandbox ledger, a scored transfer and a hold.
    a_customer = customers.get(A, SHARED_REF)
    assert client.post(f"/v1/accounts/{SHARED_REF}/topup", json={"amount": 500_000},
                       headers=_session(A)).status_code == 200
    scored = client.post("/v1/shield/analyze", json=_transfer(client_reference="alpha-ref-1"),
                         headers=_session(A))
    assert scored.status_code == 200, scored.text
    hold = client.post("/v1/ghost/create", headers=_session(A), json={
        "user_id": SHARED_REF, "risk_score": 0.9, "explanation": "test",
        "transaction": {"amount": 1_000, "recipient_account": "0123456789", "recipient_bank": "Test Bank"},
    })
    assert hold.status_code == 200, hold.text
    yield {
        "client": client,
        "keys": keys,
        "a_customer": a_customer,
        "txid": scored.json()["transaction_id"],
        "ghost_id": hold.json()["ghost_id"],
        "cursor": cursor,
    }


def _probes(w) -> list[tuple[str, str, dict | None]]:
    """Every customer-facing endpoint, aimed at Alpha's customer, hold and transfer."""
    ref, txid, gid = SHARED_REF, w["txid"], w["ghost_id"]
    return [
        ("get", f"/v1/accounts/{ref}", None),
        ("get", f"/v1/accounts/{ref}/statement", None),
        ("get", f"/v1/accounts/{ref}/security", None),
        ("post", f"/v1/accounts/{ref}/security/contact", {"email": "x@y.ng"}),
        ("get", f"/v1/notifications/{ref}", None),
        ("get", f"/v1/copilot/transparency/{ref}", None),
        ("get", f"/v1/demo/overview/{ref}", None),
        ("post", "/v1/stepup/requirement", {"user_id": ref, "risk_score": 0.6, "signals": [], "action": "FLAG", "purpose": "transfer"}),
        ("get", f"/v1/stepup/passkey/{ref}", None),
        ("get", f"/v1/ghost/{gid}", None),
        ("post", f"/v1/ghost/{gid}/cancel", {"user_id": ref}),
        ("post", f"/v1/transactions/{txid}/status", {"status": "cancelled", "user_id": ref}),
        ("get", f"/v1/shield/explanation/{txid}", None),
    ]


def _call(client, method, path, body, headers=None):
    kwargs = {"json": body} if body is not None else {}
    return getattr(client, method)(path, headers=headers or {}, **kwargs)


def test_no_credential_is_refused_everywhere(world):
    c = world["client"]
    for method, path, body in _probes(world):
        assert _call(c, method, path, body).status_code == 401, path
    assert c.post("/v1/shield/analyze", json=_transfer(institution_id=A)).status_code == 401


def test_another_bank_cannot_see_or_touch_anything(world):
    """Beta, signed in or with its key, gets "not found" for Alpha's hold and
    transfer, and its own customer, never Alpha's, for the shared reference."""
    c, keys = world["client"], world["keys"]
    for creds in (_session(B), {"X-API-Key": keys[B]}):
        for method, path, body in _probes(world):
            if "ghost" in path or "/transactions/" in path or "explanation" in path:
                assert _call(c, method, path, body, creds).status_code == 404, path
        overview = c.get(f"/v1/demo/overview/{SHARED_REF}", headers=creds)
        if overview.status_code == 200:
            assert all(t["id"] != world["txid"] for t in overview.json()["transactions"])


def test_a_claimed_institution_is_ignored(world):
    """A body naming another bank changes nothing: the transfer is Alpha's."""
    c = world["client"]
    res = c.post("/v1/shield/analyze", json=_transfer(institution_id=B), headers=_session(A))
    assert res.status_code == 200
    with world["cursor"]() as cur:
        cur.execute("SELECT institution_id, user_id FROM transactions WHERE id = ?", (res.json()["transaction_id"],))
        row = cur.fetchone()
    assert row["institution_id"] == A
    assert row["user_id"] == world["a_customer"]["id"]


def test_same_reference_at_two_banks_shares_nothing(world):
    from core import customers

    a, b = customers.get(A, SHARED_REF), customers.get(B, SHARED_REF)
    assert a["id"] != b["id"]
    with world["cursor"]() as cur:
        cur.execute("SELECT COUNT(*) FROM transactions WHERE user_id = ?", (b["id"],))
        assert cur.fetchone()[0] == 0  # every Alpha transfer stayed with Alpha's customer


def test_a_replayed_reference_never_returns_another_banks_decision(world):
    c = world["client"]
    res = c.post("/v1/shield/analyze", json=_transfer(client_reference="alpha-ref-1"), headers=_session(B))
    assert res.status_code in (200, 422)  # Beta's own customer, scored fresh (422 = no sandbox funds)
    if res.status_code == 200:
        assert res.json()["transaction_id"] != world["txid"]


def test_live_bank_needs_its_key_and_refuses_browser_sessions(world):
    c, keys = world["client"], world["keys"]
    with world["cursor"]() as cur:
        cur.execute("UPDATE institutions SET mode = 'live' WHERE institution_id = ?", (A,))
    try:
        for method, path, body in _probes(world):
            assert _call(c, method, path, body).status_code == 401, path
            assert _call(c, method, path, body, _session(A)).status_code == 403, path
            own = _call(c, method, path, body, {"X-API-Key": keys[A]}).status_code
            assert own not in (401, 403, 404), (path, own)
        assert c.get("/v1/sandbox/customers", headers=_session(A)).status_code == 409
    finally:
        with world["cursor"]() as cur:
            cur.execute("UPDATE institutions SET mode = 'sandbox' WHERE institution_id = ?", (A,))


def test_a_suspended_bank_is_refused_everywhere(world):
    c, keys = world["client"], world["keys"]
    with world["cursor"]() as cur:
        cur.execute("UPDATE institutions SET status = 'suspended' WHERE institution_id = ?", (A,))
    try:
        assert c.get("/v1/dashboard/stats", headers=_session(A)).status_code == 403
        assert c.get(f"/v1/accounts/{SHARED_REF}", headers={"X-API-Key": keys[A]}).status_code == 403
        assert c.post("/v1/shield/analyze", json=_transfer(), headers=_session(A)).status_code == 403
    finally:
        with world["cursor"]() as cur:
            cur.execute("UPDATE institutions SET status = 'active' WHERE institution_id = ?", (A,))


def test_cross_bank_attempts_are_audited(world):
    c = world["client"]
    c.get(f"/v1/ghost/{world['ghost_id']}", headers=_session(B))
    with world["cursor"]() as cur:
        cur.execute(
            "SELECT COUNT(*) FROM audit_log WHERE event_type = 'security.access_denied' AND institution_id = ?",
            (B,),
        )
        assert cur.fetchone()[0] >= 1


def test_public_surfaces_reveal_nothing_private(world):
    c = world["client"]
    assert c.get("/v1/institutions").status_code in (404, 405)  # no list of banks
    public = c.get(f"/v1/institutions/{A}").json()
    assert "contact_email" not in public and "customers" not in public
    own = c.get(f"/v1/institutions/{A}", headers=_session(A)).json()
    assert own["contact_email"] == "risk@alphabank.ng"
    assert c.post("/v1/assistant/chat", json={"message": "hi", "institution_id": A}).status_code == 401


def test_sandbox_lists_only_the_banks_own_test_customers(world):
    from core import customers

    customers.create(A, "REAL-1", kind="real", source="api", display_name="Real Person")
    c = world["client"]
    refs = {x["reference"] for x in c.get("/v1/sandbox/customers", headers=_session(A)).json()["customers"]}
    assert SHARED_REF in refs and "REAL-1" not in refs
    other = c.get("/v1/sandbox/customers", headers=_session(B)).json()["customers"]
    assert all(x["user_id"] != world["a_customer"]["id"] for x in other)
    assert c.get("/v1/sandbox/customers").status_code == 401


def test_console_customer_list_is_the_banks_own(world):
    c = world["client"]
    mine = c.get("/v1/customers", headers=_session(A)).json()
    assert mine["total"] >= 1
    assert all(x["id"] != world["a_customer"]["id"] for x in c.get("/v1/customers", headers=_session(B)).json()["customers"])
    assert c.get(f"/v1/customers/{world['a_customer']['id']}", headers=_session(B)).status_code == 404
    assert c.get(f"/v1/customers/{SHARED_REF}", headers=_session(A)).json()["id"] == world["a_customer"]["id"]
    assert c.get("/v1/customers").status_code == 401
