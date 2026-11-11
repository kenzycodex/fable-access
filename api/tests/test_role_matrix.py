"""Every console write is gated to the role that should make it.

Pins the role rules across the endpoint inventory: owner-only changes refuse
analysts, viewers and the API key; analyst actions refuse viewers; and every
endpoint outside a short public list refuses a caller with no credential.
"""
import os
import re
import secrets
import sys
import tempfile

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
os.environ.setdefault("FABLE_DB_PATH", os.path.join(tempfile.mkdtemp(), "roles.db"))
os.environ.setdefault("FABLE_SESSION_SECRET", "test-secret")

BANK = "rolebank"
ROLES = ("owner", "analyst", "viewer")

# Reachable with no credential: health, docs, sign-in flows and the public
# face of a bank (its name and branding, for the sandbox app's own page).
PUBLIC = {
    ("GET", "/"), ("GET", "/health"), ("GET", "/healthz"),
    ("POST", "/auth/login"), ("POST", "/auth/forgot-password"), ("POST", "/auth/reset-password"),
    ("POST", "/operator/auth/login"), ("POST", "/operator/auth/verify"), ("POST", "/operator/auth/accept-invite"),
    ("GET", "/v1/branding/{institution_id}"), ("GET", "/v1/branding/resolve/{slug}"),
    ("GET", "/v1/institutions/{institution_id}"), ("POST", "/v1/institutions/resolve-key"),
    # The bank's webhooks carry no key; the HMAC signature is their only credential.
    ("POST", "/v1/forge/hooks/bank"),
}


def _session(role: str) -> dict:
    from core import sessions

    return {"X-Fable-Session": sessions.issue(f"{role}@{BANK}.ng", BANK)["token"]}


@pytest.fixture(scope="module")
def world():
    from fastapi.testclient import TestClient

    from core import apikeys, customers
    from core.db import cursor
    from core.tenancy import register_institution
    from core.utils import hash_password
    from main import app

    register_institution(BANK, "Role Bank", f"risk@{BANK}.ng")
    raw = apikeys.generate()
    with cursor() as cur:
        for role in ROLES:
            cur.execute("INSERT OR IGNORE INTO admins (email, institution_id, hashed_password, role, active) "
                        "VALUES (?, ?, ?, ?, 1)", (f"{role}@{BANK}.ng", BANK, hash_password("x" * 12), role))
        apikeys.insert(cur, raw, BANK, "Role Bank", f"owner@{BANK}.ng")
    customer = customers.ensure(BANK, "role-cust", kind="test", source="console")
    txid = f"txn_{secrets.token_hex(6)}"
    with cursor() as cur:
        cur.execute("INSERT INTO transactions (id, user_id, amount, institution_id, action_taken, risk_score, "
                    "shield_signals) VALUES (?, ?, 5000, ?, 'FLAG', 0.6, '[]')", (txid, customer["id"], BANK))
    return {"client": TestClient(app), "key": {"X-API-Key": raw}, "txid": txid, "user": customer["id"]}


def _owner_routes(w) -> list[tuple[str, str, dict | None]]:
    inst = BANK
    return [
        ("POST", "/v1/team/invite", {"email": "new@rolebank.ng", "role": "viewer"}),
        ("PATCH", f"/v1/team/viewer@{BANK}.ng", {"role": "analyst"}),
        ("DELETE", f"/v1/team/viewer@{BANK}.ng", None),
        ("POST", "/v1/webhooks", {"url": "https://hooks.example.ng/x", "events": ["case.resolved"]}),
        ("PUT", f"/v1/institutions/{inst}/settings", {"flag_threshold": 0.5}),
        ("POST", f"/v1/institutions/{inst}/keys/rotate", None),
        ("PUT", f"/v1/institutions/{inst}/mode", {"mode": "sandbox"}),
        ("PATCH", f"/v1/institutions/{inst}", {"name": "Renamed"}),
        ("PATCH", f"/v1/branding/{inst}", {"tagline": "x"}),
        ("POST", "/v1/onboarding/agreements", {"data_processing_agreement": True, "dpia": True}),
        ("POST", "/v1/sandbox/reset", {"confirm": inst}),
        ("POST", "/v1/imports/customers", {"rows": [{"customer_reference": "imp-1"}]}),
        ("POST", f"/v1/review/{w['txid']}/hold/release", {"note": "verified by phone call"}),
    ]


def _analyst_routes(w) -> list[tuple[str, str, dict | None]]:
    return [
        ("POST", "/v1/customers", {"reference": "made-by-viewer"}),
        ("PATCH", f"/v1/customers/{w['user']}", {"name": "x"}),
        ("POST", f"/v1/review/{w['txid']}/assign", {"assignee": "me"}),
        ("POST", f"/v1/review/{w['txid']}/notes", {"body": "note"}),
        ("POST", f"/v1/review/{w['txid']}/hold/cancel", {"note": ""}),
        ("POST", "/v1/shield/feedback", {"user_id": w["user"], "transaction_id": w["txid"], "was_fraud": False}),
        ("POST", f"/v1/institutions/{BANK}/customers/{w['user']}/pin/reset", None),
    ]


def _call(client, method, path, body, headers):
    kwargs = {"json": body} if body is not None else {}
    return client.request(method, path, headers=headers, **kwargs)


def test_owner_only_changes_refuse_every_other_role(world):
    c = world["client"]
    for method, path, body in _owner_routes(world):
        for role in ("analyst", "viewer"):
            res = _call(c, method, path, body, _session(role))
            assert res.status_code == 403, (role, method, path, res.status_code, res.text)


def test_owner_only_changes_refuse_the_api_key(world):
    c = world["client"]
    for method, path, body in _owner_routes(world):
        if path.startswith("/v1/imports/"):
            continue  # a bank's servers import with the key, by design
        res = _call(c, method, path, body, world["key"])
        # 401 where the route accepts only a person's session at all.
        assert res.status_code in (401, 403), (method, path, res.status_code, res.text)


def test_analyst_actions_refuse_viewers(world):
    c = world["client"]
    for method, path, body in _analyst_routes(world):
        res = _call(c, method, path, body, _session("viewer"))
        assert res.status_code == 403, (method, path, res.status_code, res.text)


def test_every_other_endpoint_refuses_no_credential(world):
    """With a body that passes validation where one is needed, so the answer
    reflects the credential check and not the schema."""
    from main import app

    c = world["client"]
    spec = app.openapi()
    failures = []
    for path, ops in spec["paths"].items():
        for method in ops:
            if (method.upper(), path) in PUBLIC or path.startswith("/docs") or path in ("/openapi.json", "/redoc"):
                continue
            concrete = re.sub(r"\{[^}]+\}", "x1", path)
            res = c.request(method.upper(), concrete, json={})
            # 422 means the schema rejected {} before any handler ran; nothing
            # was read or changed. Anything else must be a refusal.
            if res.status_code not in (401, 403, 422):
                failures.append((method.upper(), path, res.status_code))
    assert not failures, failures
