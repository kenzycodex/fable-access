"""The console's agent status is real, not a hardcoded "All running".

  * Ghost reads "off" when the institution switched it off.
  * Ghost reads "degraded" when its hold updates are failing to reach the
    bank's webhook, which is how a live bank learns to send or return funds.
  * Watch is planned, and says so.
"""
import os
import sys
import tempfile

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
os.environ.setdefault("FABLE_DB_PATH", os.path.join(tempfile.mkdtemp(), "agents-status.db"))
os.environ.setdefault("FABLE_SESSION_SECRET", "test-secret")

BANK = "agentstatusbank"


@pytest.fixture(scope="module")
def client():
    from fastapi.testclient import TestClient

    from core.tenancy import register_institution
    from main import app

    register_institution(BANK, "Agent Status Bank", "risk@agentstatus.ng")
    return TestClient(app)


def _overview(client) -> dict:
    from core import sessions

    token = sessions.issue(f"owner@{BANK}.ng", BANK)["token"]
    res = client.get("/v1/agents/overview", headers={"X-Fable-Session": token})
    assert res.status_code == 200, res.text
    return res.json()


def test_a_healthy_ghost_is_active_and_watch_is_planned(client):
    body = _overview(client)
    assert body["ghost"]["status"] == "active"
    assert body["watch"]["status"] == "planned"


def test_failed_hold_updates_mark_ghost_degraded(client):
    from core.db import cursor

    with cursor() as cur:
        cur.execute("INSERT INTO webhook_outbox (webhook_id, institution_id, event, event_id, payload, status) "
                    "VALUES ('wh_x', ?, 'containment.released', 'evt_failed_1', '{}', 'failed')", (BANK,))
    ghost = _overview(client)["ghost"]
    assert ghost["status"] == "degraded" and "webhook" in ghost["detail"]
    with cursor() as cur:
        cur.execute("DELETE FROM webhook_outbox WHERE event_id = 'evt_failed_1'")


def test_a_switched_off_ghost_reads_off(client):
    from core.tenancy import set_disabled_agents

    set_disabled_agents(BANK, {"ghost"})
    try:
        assert _overview(client)["ghost"]["status"] == "off"
    finally:
        set_disabled_agents(BANK, set())
