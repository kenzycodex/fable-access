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

from db import cursor, dumps

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
ADMIN_LOGIN = "admin.login"
INSTITUTION_PROVISIONED = "institution.provisioned"


def record(event_type: str, user_id: str | None = None, **payload) -> None:
    """Append one event. Best effort, by design.

    `institution_id` is pulled out of the payload and stored in its own column
    so the compliance view can scope directly rather than inferring a tenant by
    joining through transactions.
    """
    institution_id = payload.get("institution_id")
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

    Scoped on the event's own institution_id. Platform-level events (a startup
    sweep, for instance) carry none and are included for every tenant, because
    they describe the system rather than a bank's customers.
    """
    from db import loads, row_to_dict

    sql = "SELECT id, user_id, event_type, payload, created_at FROM audit_log"
    params: list = []
    if institution_id:
        sql += " WHERE institution_id = ? OR institution_id IS NULL"
        params.append(institution_id)
    sql += " ORDER BY id DESC LIMIT ?"
    params.append(limit)

    try:
        with cursor() as cur:
            cur.execute(sql, params)
            rows = [row_to_dict(r) for r in cur.fetchall()]
        for r in rows:
            r["payload"] = loads(r.get("payload"), {}) or {}
        return rows
    except Exception as exc:  # noqa: BLE001
        logger.warning("Audit read failed: %s", exc)
        return []
