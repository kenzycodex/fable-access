"""Review queue: the analyst's side of a flagged or blocked transfer.

Shield decides in milliseconds; a person at the bank then decides what the
decision meant. Every FLAG and BLOCK is a case that starts open. An analyst can
take it, escalate it, leave notes and resolve it as fraud or legitimate.

Resolving labels the transaction. It does not move money: funds still move only
through the customer's own step-up or containment flow, so an analyst account
can never become a way to push a blocked transfer through.
"""
from datetime import datetime, timezone

from fastapi import APIRouter, HTTPException, Query, Request
from pydantic import BaseModel, Field

from core.db import cursor, loads, row_to_dict
from core.tenancy import require_role, tenant_for_console
from routers.dashboard import TXN_COLUMNS, shape_rows, txn_filters
from services import audit, webhooks

router = APIRouter(prefix="/v1/review", tags=["review"])

STATES = ("open", "in_review", "escalated", "resolved")
_STATE_SQL = "COALESCE(review_state, 'open')"


def _now() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%S")


def _case(institution: str, txid: str) -> dict:
    """A reviewable transaction in this institution, or 404."""
    with cursor() as cur:
        cur.execute(
            f"SELECT {TXN_COLUMNS} FROM transactions WHERE id = ? AND institution_id = ?",
            (txid, institution),
        )
        row = row_to_dict(cur.fetchone())
    if not row:
        raise HTTPException(status_code=404, detail="Case not found.")
    if row.get("action_taken") not in ("FLAG", "BLOCK"):
        raise HTTPException(status_code=409, detail="Only flagged or blocked transfers are reviewed.")
    return shape_rows([row], institution)[0]


@router.get("/queue")
def queue(
    request: Request,
    state: str | None = Query(None, description="open, in_review, escalated, resolved, or active"),
    action: str | None = Query(None),
    assignee: str | None = Query(None),
    date_from: str | None = Query(None, alias="from"),
    date_to: str | None = Query(None, alias="to"),
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
):
    institution = tenant_for_console(request)
    where, params = txn_filters(
        institution, action=action or "FLAG,BLOCK", date_from=date_from, date_to=date_to
    )
    where += " AND action_taken IN ('FLAG','BLOCK')"
    if state == "active":
        where += f" AND {_STATE_SQL} != 'resolved'"
    elif state:
        if state not in STATES:
            raise HTTPException(status_code=400, detail=f"state must be one of {', '.join(STATES)} or active.")
        where += f" AND {_STATE_SQL} = ?"
        params.append(state)
    if assignee:
        if assignee == "me":
            assignee = require_role(request, "viewer")["email"]
        where += " AND assignee = ?"
        params.append(assignee)

    with cursor() as cur:
        cur.execute(f"SELECT COUNT(*) AS n FROM transactions {where}", params)
        total = cur.fetchone()["n"]
        # Escalated first, then the riskiest, then the newest: the order an
        # analyst should work them in.
        cur.execute(
            f"""SELECT {TXN_COLUMNS} FROM transactions {where}
                ORDER BY CASE {_STATE_SQL} WHEN 'escalated' THEN 0 WHEN 'in_review' THEN 1
                                           WHEN 'open' THEN 2 ELSE 3 END,
                         CASE WHEN {_STATE_SQL} = 'resolved' THEN reviewed_at END DESC,
                         risk_score DESC, created_at DESC
                LIMIT ? OFFSET ?""",
            params + [limit, offset],
        )
        rows = shape_rows([row_to_dict(r) for r in cur.fetchall()], institution)
    return {"total": total, "limit": limit, "offset": offset, "cases": rows}


@router.get("/counts")
def counts(request: Request):
    institution = tenant_for_console(request)
    with cursor() as cur:
        cur.execute(
            f"""SELECT {_STATE_SQL} AS s, COUNT(*) AS n FROM transactions
                WHERE institution_id = ? AND action_taken IN ('FLAG','BLOCK')
                GROUP BY s""",
            (institution,),
        )
        by_state = {r["s"]: r["n"] for r in cur.fetchall()}
        cur.execute(
            """SELECT review_outcome AS o, COUNT(*) AS n FROM transactions
               WHERE institution_id = ? AND review_outcome IS NOT NULL GROUP BY o""",
            (institution,),
        )
        by_outcome = {r["o"]: r["n"] for r in cur.fetchall()}
    active = sum(n for s, n in by_state.items() if s != "resolved")
    return {
        "open": by_state.get("open", 0),
        "in_review": by_state.get("in_review", 0),
        "escalated": by_state.get("escalated", 0),
        "resolved": by_state.get("resolved", 0),
        "active": active,
        "confirmed_fraud": by_outcome.get("fraud", 0),
        "confirmed_legitimate": by_outcome.get("legitimate", 0),
    }


@router.get("/{txid}")
def case_detail(txid: str, request: Request):
    institution = tenant_for_console(request)
    case = _case(institution, txid)
    user_id = case.get("user_id")

    with cursor() as cur:
        cur.execute(
            "SELECT id, author, body, created_at FROM case_notes WHERE transaction_id = ? AND institution_id = ? ORDER BY id ASC",
            (txid, institution),
        )
        notes = [row_to_dict(r) for r in cur.fetchall()]

        # What the analyst needs to judge this customer, from their own history
        # at this bank: how they normally behave, and whether they have been
        # here before.
        cur.execute(
            """SELECT COUNT(*) AS n, AVG(amount) AS avg_amount, MAX(amount) AS max_amount,
                      MIN(created_at) AS first_seen,
                      SUM(CASE WHEN action_taken IN ('FLAG','BLOCK') THEN 1 ELSE 0 END) AS risky,
                      SUM(CASE WHEN review_outcome = 'fraud' THEN 1 ELSE 0 END) AS confirmed_fraud
               FROM transactions WHERE user_id = ? AND institution_id = ? AND id != ?""",
            (user_id, institution, txid),
        )
        history = row_to_dict(cur.fetchone()) or {}

        cur.execute(
            """SELECT COUNT(*) AS n FROM transactions
               WHERE user_id = ? AND institution_id = ? AND id != ?
                 AND recipient_account = ? AND action_taken = 'PASS'""",
            (user_id, institution, txid, case.get("recipient_account")),
        )
        paid_before = cur.fetchone()["n"]

        cur.execute(
            """SELECT ghost_id, status, cooling_window_minutes, created_at, resolved_at
               FROM ghost_containers
               WHERE user_id = ? AND institution_id = ? AND amount = ?
               ORDER BY created_at DESC LIMIT 1""",
            (user_id, institution, case.get("amount")),
        )
        containment = row_to_dict(cur.fetchone())

        cur.execute(
            """SELECT id, event_type, payload, created_at FROM audit_log
               WHERE institution_id = ? AND event_type LIKE 'case.%' ORDER BY id DESC LIMIT 200""",
            (institution,),
        )
        trail = []
        for r in cur.fetchall():
            payload = loads(r["payload"], {}) or {}
            if payload.get("transaction_id") == txid:
                trail.append({"event_type": r["event_type"], "payload": payload, "created_at": r["created_at"]})

    return {
        "case": case,
        "notes": notes,
        "history": {
            "transactions": history.get("n") or 0,
            "avg_amount": round(history.get("avg_amount") or 0, 2),
            "max_amount": history.get("max_amount") or 0,
            "first_seen": history.get("first_seen"),
            "previously_flagged": history.get("risky") or 0,
            "confirmed_fraud": history.get("confirmed_fraud") or 0,
            "paid_this_recipient_before": paid_before,
        },
        "containment": containment,
        "activity": list(reversed(trail)),
    }


class AssignBody(BaseModel):
    assignee: str | None = Field(None, description='An admin email, "me", or null to unassign')


@router.post("/{txid}/assign")
def assign(txid: str, body: AssignBody, request: Request):
    who = require_role(request, "analyst")
    case = _case(who["inst"], txid)
    if case["review_state"] == "resolved":
        raise HTTPException(status_code=409, detail="This case is resolved. Reopen it first.")

    target = who["email"] if body.assignee == "me" else body.assignee
    if target:
        with cursor() as cur:
            cur.execute(
                "SELECT 1 FROM admins WHERE email = ? AND institution_id = ? AND COALESCE(active, 1) = 1",
                (target, who["inst"]),
            )
            known = cur.fetchone() is not None
        # An API key acts as "api-key", which has no admins row.
        if not known and target != who["email"]:
            raise HTTPException(status_code=404, detail="No active team member with that email.")

    state = "in_review" if target else "open"
    with cursor() as cur:
        cur.execute(
            "UPDATE transactions SET assignee = ?, review_state = ? WHERE id = ? AND institution_id = ?",
            (target, state, txid, who["inst"]),
        )
    audit.record(audit.CASE_ASSIGNED, case.get("user_id"), institution_id=who["inst"],
                 transaction_id=txid, assignee=target, by=who["email"])
    return {"id": txid, "assignee": target, "review_state": state}


class EscalateBody(BaseModel):
    reason: str | None = Field(None, max_length=1000)


@router.post("/{txid}/escalate")
def escalate(txid: str, body: EscalateBody, request: Request):
    who = require_role(request, "analyst")
    case = _case(who["inst"], txid)
    if case["review_state"] == "resolved":
        raise HTTPException(status_code=409, detail="This case is resolved. Reopen it first.")
    with cursor() as cur:
        cur.execute(
            "UPDATE transactions SET review_state = 'escalated' WHERE id = ? AND institution_id = ?",
            (txid, who["inst"]),
        )
        if body.reason and body.reason.strip():
            cur.execute(
                "INSERT INTO case_notes (transaction_id, institution_id, author, body) VALUES (?, ?, ?, ?)",
                (txid, who["inst"], who["email"], "Escalated: " + body.reason.strip()),
            )
    audit.record(audit.CASE_ESCALATED, case.get("user_id"), institution_id=who["inst"],
                 transaction_id=txid, by=who["email"])
    return {"id": txid, "review_state": "escalated"}


class NoteBody(BaseModel):
    body: str = Field(..., min_length=1, max_length=2000)


@router.post("/{txid}/notes")
def add_note(txid: str, body: NoteBody, request: Request):
    who = require_role(request, "analyst")
    case = _case(who["inst"], txid)
    text = body.body.strip()
    if not text:
        raise HTTPException(status_code=422, detail="A note cannot be empty.")
    with cursor() as cur:
        cur.execute(
            "INSERT INTO case_notes (transaction_id, institution_id, author, body) VALUES (?, ?, ?, ?)",
            (txid, who["inst"], who["email"], text),
        )
        note_id = cur.lastrowid
    audit.record(audit.CASE_NOTED, case.get("user_id"), institution_id=who["inst"],
                 transaction_id=txid, by=who["email"])
    return {"id": note_id, "author": who["email"], "body": text, "created_at": _now()}


class ResolveBody(BaseModel):
    outcome: str = Field(..., description="fraud or legitimate")
    note: str | None = Field(None, max_length=2000)


@router.post("/{txid}/resolve")
def resolve(txid: str, body: ResolveBody, request: Request):
    who = require_role(request, "analyst")
    if body.outcome not in ("fraud", "legitimate"):
        raise HTTPException(status_code=400, detail="outcome must be fraud or legitimate.")
    case = _case(who["inst"], txid)
    now = _now()
    with cursor() as cur:
        # confirmed_legitimate is what Copilot learns from: a transfer confirmed
        # as fraud must never become part of the customer's "normal".
        cur.execute(
            """UPDATE transactions
               SET review_state = 'resolved', review_outcome = ?, reviewed_by = ?, reviewed_at = ?,
                   confirmed_legitimate = ?, assignee = COALESCE(assignee, ?)
               WHERE id = ? AND institution_id = ?""",
            (body.outcome, who["email"], now, 1 if body.outcome == "legitimate" else 0,
             who["email"], txid, who["inst"]),
        )
        if body.note and body.note.strip():
            cur.execute(
                "INSERT INTO case_notes (transaction_id, institution_id, author, body) VALUES (?, ?, ?, ?)",
                (txid, who["inst"], who["email"], body.note.strip()),
            )
    audit.record(audit.CASE_RESOLVED, case.get("user_id"), institution_id=who["inst"],
                 transaction_id=txid, outcome=body.outcome, amount=case.get("amount"), by=who["email"])
    webhooks.emit(who["inst"], "case.resolved", {
        **webhooks.transaction_summary(case),
        "review_outcome": body.outcome,
        "reviewed_by": who["email"],
        "reviewed_at": now,
    })
    return {"id": txid, "review_state": "resolved", "review_outcome": body.outcome,
            "reviewed_by": who["email"], "reviewed_at": now}


@router.post("/{txid}/reopen")
def reopen(txid: str, request: Request):
    who = require_role(request, "analyst")
    case = _case(who["inst"], txid)
    if case["review_state"] != "resolved":
        raise HTTPException(status_code=409, detail="Only a resolved case can be reopened.")
    with cursor() as cur:
        # The label is withdrawn, so the learning flag goes back to what the
        # customer's own flow established: a transfer they verified and
        # completed counts as normal, anything still stopped does not.
        cur.execute(
            """UPDATE transactions
               SET review_state = 'open', review_outcome = NULL, reviewed_by = NULL,
                   reviewed_at = NULL,
                   confirmed_legitimate = CASE WHEN status IN ('completed','released') THEN 1 ELSE 0 END
               WHERE id = ? AND institution_id = ?""",
            (txid, who["inst"]),
        )
    audit.record(audit.CASE_REOPENED, case.get("user_id"), institution_id=who["inst"],
                 transaction_id=txid, by=who["email"])
    return {"id": txid, "review_state": "open"}
