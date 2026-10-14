"""Audit trail.

The `audit_log` table has existed since the first schema and has never had a
single row written to it. Meanwhile the console ships a Compliance page citing
FATF typologies, so the one table that would substantiate that story was empty.

What belongs here is anything a compliance officer would need to reconstruct
after the fact: who moved money, who proved their identity and how, who failed
to, and who changed the configuration that decides any of it. Scoring decisions
are deliberately *not* logged here — every transfer already persists its score
and signals, and duplicating that would make the audit trail mostly noise.

Never raises. An audit write must not be able to fail the action it records,
because a failure here would turn a working transfer into a broken one.
"""
import logging

from core.db import cursor, dumps

logger = logging.getLogger("fable.audit")

# Events worth reconstructing later. Keeping them named rather than free-text
# means the compliance view can group and filter without parsing prose.
CONTAINMENT_CREATED = "containment.created"
CONTAINMENT_RELEASED = "containment.released"
CONTAINMENT_CANCELLED = "containment.cancelled"
CONTAINMENT_EXPIRED = "containment.expired"
STEPUP_PASSED = "stepup.passed"
STEPUP_FAILED = "stepup.failed"
TRANSFER_APPROVED = "transfer.approved"
SECURITY_CHANGED = "security.changed"
ACCOUNT_TOPUP = "account.topup"
INSTITUTION_UPDATED = "institution.updated"
ADMIN_LOGIN = "admin.login"
INSTITUTION_PROVISIONED = "institution.provisioned"
CASE_ASSIGNED = "case.assigned"
CASE_ESCALATED = "case.escalated"
CASE_RESOLVED = "case.resolved"
CASE_NOTED = "case.noted"
CASE_REOPENED = "case.reopened"
FEEDBACK_RECORDED = "feedback.recorded"
POLICY_CHANGED = "policy.changed"
TEAM_INVITED = "team.invited"
TEAM_ROLE_CHANGED = "team.role_changed"
TEAM_REMOVED = "team.removed"
PASSWORD_CHANGED = "admin.password_changed"
KEY_ROTATED = "apikey.rotated"
WEBHOOK_CREATED = "webhook.created"
WEBHOOK_DELETED = "webhook.deleted"
MODE_CHANGED = "institution.mode_changed"
ACCESS_DENIED = "security.access_denied"
CUSTOMER_CREATED = "customer.created"
CUSTOMER_UPDATED = "customer.updated"
IMPORT_APPLIED = "import.applied"
AGREEMENTS_CONFIRMED = "institution.agreements_confirmed"
INSTITUTION_SUSPENDED = "institution.suspended"
INSTITUTION_REACTIVATED = "institution.reactivated"
OWNER_INVITED = "institution.owner_invited"
OPERATOR_LOGIN = "operator.login"
OPERATOR_INVITED = "operator.invited"
OPERATOR_CHANGED = "operator.changed"


def _institution_of(user_id: str | None) -> str | None:
    """Which institution a customer belongs to, when the caller did not say.

    An event with no institution is read as platform-level and is shown to every
    tenant, so a customer's event must never be stored without one. Callers deep
    in the step-up code know the user but not the tenant; this finds it.
    """
    if not user_id:
        return None
    try:
        with cursor() as cur:
            cur.execute("SELECT institution_id FROM customers WHERE id = ?", (user_id,))
            row = cur.fetchone()
            if row and row["institution_id"]:
                return row["institution_id"]
            for table in ("accounts", "user_security", "fable_users", "transactions"):
                cur.execute(
                    f"SELECT institution_id FROM {table} WHERE user_id = ? AND institution_id IS NOT NULL LIMIT 1",
                    (user_id,),
                )
                row = cur.fetchone()
                if row and row["institution_id"]:
                    return row["institution_id"]
    except Exception:  # noqa: BLE001 — never let a lookup break the audited action
        pass
    return None


def for_institution(payload: dict) -> dict:
    """An event's details as a bank sees them. An action a Fable operator took
    on the bank shows as Fable's, without naming the member of staff; the
    operator platform keeps the name in its own view of the same event."""
    if isinstance(payload, dict) and payload.get("operator"):
        return {**payload, "operator": "Fable"}
    return payload


def record(event_type: str, user_id: str | None = None, **payload) -> None:
    """Append one event. Best effort, by design.

    `institution_id` is pulled out of the payload and stored in its own column
    so the compliance view can scope directly rather than inferring a tenant by
    joining through transactions.
    """
    institution_id = payload.get("institution_id") or _institution_of(user_id)
    try:
        with cursor() as cur:
            cur.execute(
                "INSERT INTO audit_log (user_id, institution_id, event_type, payload) "
                "VALUES (?, ?, ?, ?)",
                (user_id, institution_id, event_type, dumps(payload) if payload else None),
            )
    except Exception as exc:  # noqa: BLE001 — auditing must never break the caller
        logger.warning("Audit write failed for %s: %s", event_type, exc)


def recent(institution_id: str | None = None, limit: int = 100) -> list[dict]:
    """Recent events, newest first.

    Scoped strictly on the event's own institution_id. Events with no
    institution (operator sign-ins and team changes, startup housekeeping)
    belong to Fable, not to any bank, and are never shown to one.
    """
    from core.db import loads, row_to_dict

    sql = "SELECT id, user_id, event_type, payload, created_at FROM audit_log"
    params: list = []
    if institution_id:
        sql += " WHERE institution_id = ?"
        params.append(institution_id)
    sql += " ORDER BY id DESC LIMIT ?"
    params.append(limit)

    try:
        with cursor() as cur:
            cur.execute(sql, params)
            rows = [row_to_dict(r) for r in cur.fetchall()]
        for r in rows:
            r["payload"] = for_institution(loads(r.get("payload"), {}) or {})
        return rows
    except Exception as exc:  # noqa: BLE001
        logger.warning("Audit read failed: %s", exc)
        return []
