"""Managing an institution's webhook endpoints from the console.

Named webhooks_admin so it does not shadow the top-level `webhooks` module that
does the sending.
"""
import secrets

from fastapi import APIRouter, HTTPException, Query, Request
from pydantic import BaseModel, Field

import audit
import webhooks
from db import cursor, row_to_dict
from tenancy import require_role

router = APIRouter(prefix="/v1/webhooks", tags=["webhooks"])

MAX_ENDPOINTS = 5


def _public(row: dict) -> dict:
    """An endpoint as the console shows it. The secret is never returned again."""
    return {
        "id": row["id"],
        "url": row["url"],
        "events": [e for e in (row["events"] or "").split(",") if e],
        "active": bool(row["active"]),
        "created_at": row["created_at"],
        "created_by": row.get("created_by"),
        "last_delivery": row.get("last_delivery"),
    }


@router.get("")
def list_endpoints(request: Request):
    who = require_role(request, "viewer")
    with cursor() as cur:
        cur.execute(
            """SELECT w.*, (
                   SELECT json_object('ok', d.ok, 'status_code', d.status_code, 'event', d.event,
                                      'error', d.error, 'created_at', d.created_at)
                   FROM webhook_deliveries d WHERE d.webhook_id = w.id ORDER BY d.id DESC LIMIT 1
               ) AS last_delivery
               FROM webhooks w WHERE w.institution_id = ? ORDER BY w.created_at ASC""",
            (who["inst"],),
        )
        rows = [row_to_dict(r) for r in cur.fetchall()]
    import json

    for r in rows:
        r["last_delivery"] = json.loads(r["last_delivery"]) if r.get("last_delivery") else None
    return {"endpoints": [_public(r) for r in rows], "events": list(webhooks.EVENTS)}


class CreateBody(BaseModel):
    url: str = Field(..., max_length=500)
    events: list[str] = Field(default_factory=lambda: list(webhooks.EVENTS))


@router.post("")
def create_endpoint(body: CreateBody, request: Request):
    who = require_role(request, "owner")
    try:
        url = webhooks.validate_url(body.url)
    except webhooks.WebhookError as exc:
        raise HTTPException(status_code=422, detail=str(exc))
    events = sorted(set(body.events))
    unknown = [e for e in events if e not in webhooks.EVENTS]
    if unknown or not events:
        raise HTTPException(status_code=422, detail="Choose at least one valid event.")

    with cursor() as cur:
        cur.execute("SELECT COUNT(*) AS n FROM webhooks WHERE institution_id = ?", (who["inst"],))
        if cur.fetchone()["n"] >= MAX_ENDPOINTS:
            raise HTTPException(status_code=409, detail=f"You can register up to {MAX_ENDPOINTS} endpoints.")
        hook_id = "wh_" + secrets.token_hex(8)
        secret = webhooks.new_secret()
        cur.execute(
            "INSERT INTO webhooks (id, institution_id, url, secret, events, created_by) VALUES (?, ?, ?, ?, ?, ?)",
            (hook_id, who["inst"], url, secret, ",".join(events), who["email"]),
        )
        cur.execute("SELECT * FROM webhooks WHERE id = ?", (hook_id,))
        row = row_to_dict(cur.fetchone())
    audit.record(audit.WEBHOOK_CREATED, None, institution_id=who["inst"], url=url, events=events, by=who["email"])
    # The signing secret is shown exactly once, here.
    return {**_public(row), "secret": secret}


def _own(hook_id: str, inst: str) -> dict:
    with cursor() as cur:
        cur.execute("SELECT * FROM webhooks WHERE id = ? AND institution_id = ?", (hook_id, inst))
        row = row_to_dict(cur.fetchone())
    if not row:
        raise HTTPException(status_code=404, detail="Endpoint not found.")
    return row


@router.delete("/{hook_id}")
def delete_endpoint(hook_id: str, request: Request):
    who = require_role(request, "owner")
    row = _own(hook_id, who["inst"])
    with cursor() as cur:
        cur.execute("DELETE FROM webhooks WHERE id = ?", (hook_id,))
    audit.record(audit.WEBHOOK_DELETED, None, institution_id=who["inst"], url=row["url"], by=who["email"])
    return {"id": hook_id, "deleted": True}


@router.post("/{hook_id}/test")
def test_endpoint(hook_id: str, request: Request):
    """Send a signed sample event now and report what came back."""
    who = require_role(request, "owner")
    row = _own(hook_id, who["inst"])
    ok = webhooks.deliver(row, "case.resolved", {"test": True, "message": "A test event from the Fable console."},
                          sleep=lambda _s: None)
    with cursor() as cur:
        cur.execute(
            "SELECT status_code, error FROM webhook_deliveries WHERE webhook_id = ? ORDER BY id DESC LIMIT 1",
            (hook_id,),
        )
        last = row_to_dict(cur.fetchone()) or {}
    return {"ok": ok, "status_code": last.get("status_code"), "error": last.get("error")}


@router.get("/{hook_id}/deliveries")
def deliveries(hook_id: str, request: Request, limit: int = Query(25, ge=1, le=100)):
    who = require_role(request, "viewer")
    _own(hook_id, who["inst"])
    with cursor() as cur:
        cur.execute(
            """SELECT id, event, status_code, ok, error, attempt, created_at
               FROM webhook_deliveries WHERE webhook_id = ? ORDER BY id DESC LIMIT ?""",
            (hook_id, limit),
        )
        rows = [row_to_dict(r) for r in cur.fetchall()]
    for r in rows:
        r["ok"] = bool(r["ok"])
    return {"deliveries": rows}
