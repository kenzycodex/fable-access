"""A customer's rights over their data: a copy of it, and its erasure.

Fable processes customers' data for the bank (the controller), so requests
come through the bank: an owner in the console exports or erases one
customer. Both are recorded in the audit log.

Erasure removes everything that identifies the customer. Decisions and holds
are kept, because the bank's own records and its fraud statistics depend on
them, but they are cut loose from the person: their user id becomes a random
"erased_..." id that links to nothing, and every identifying field on them
(recipient, narration, device, location, IP, session) is cleared. What is left
is an amount, an outcome and a time, which the bank already holds itself.

Refused while the customer has a hold in progress: money is in flight and the
bank has to finish it first.
"""
from __future__ import annotations

import hashlib
import json
import secrets as pysecrets

from core.db import cursor, loads, row_to_dict

ERASED_PREFIX = "erased_"

# Tables keyed by the customer's id whose rows are theirs alone and are deleted.
_DELETE_BY_USER = (
    "accounts", "ledger_entries", "user_security", "user_credentials", "stepup_challenges", "stepup_tokens",
    "stepup_failures", "notifications", "sandbox_inbox", "user_locations", "device_profiles", "customer_devices",
    "transaction_history", "user_aliases", "fable_users",
)
# Identifying columns cleared on decisions that are kept.
_DECISION_PERSONAL = (
    "recipient_id", "recipient_account", "recipient_bank", "recipient_name", "narration", "device_fingerprint",
    "client_ip", "latitude", "longitude", "city", "country", "location_source", "session_duration_seconds",
    "auth_method", "typing_speed_ms", "paste_detected", "time_to_submit_seconds", "client_timestamp",
    "client_timezone", "client_reference", "explanation", "shield_signals",
)
# Payload keys that can identify a person, dropped from the customer's audit events.
_AUDIT_PERSONAL = {"recipient", "recipient_account", "recipient_name", "name", "email", "phone", "narration",
                   "reference", "external_ref", "contact", "address", "ip"}


class RightsError(Exception):
    def __init__(self, status: int, message: str):
        super().__init__(message)
        self.status = status


def _columns(cur, table: str) -> set[str]:
    cur.execute(f"PRAGMA table_info({table})")
    return {r[1] for r in cur.fetchall()}


def _rows(cur, sql: str, params) -> list[dict]:
    cur.execute(sql, params)
    return [row_to_dict(r) for r in cur.fetchall()]


def export(institution_id: str, user_id: str) -> dict:
    """Everything Fable holds about one customer, as JSON-ready sections."""
    with cursor() as cur:
        cur.execute("SELECT * FROM customers WHERE id = ? AND institution_id = ?", (user_id, institution_id))
        customer = row_to_dict(cur.fetchone())
        if not customer:
            raise RightsError(404, "Customer not found.")
        out: dict = {"customer": customer}
        out["decisions"] = _rows(cur, "SELECT * FROM transactions WHERE user_id = ? AND institution_id = ? "
                                      "ORDER BY created_at", (user_id, institution_id))
        for d in out["decisions"]:
            for key in ("shield_signals", "score_parts"):
                if isinstance(d.get(key), str):
                    d[key] = loads(d[key], d[key])
        out["imported_history"] = _rows(cur, "SELECT * FROM transaction_history WHERE user_id = ? ORDER BY created_at",
                                        (user_id,))
        out["holds"] = _rows(cur, "SELECT * FROM ghost_containers WHERE user_id = ? ORDER BY created_at", (user_id,))
        out["devices"] = _rows(cur, "SELECT * FROM customer_devices WHERE user_id = ?", (user_id,))
        out["locations"] = _rows(cur, "SELECT * FROM user_locations WHERE user_id = ? ORDER BY seen_at", (user_id,))
        out["notifications"] = _rows(cur, "SELECT * FROM notifications WHERE user_id = ? ORDER BY created_at",
                                     (user_id,))
        # Security settings as facts, never the PIN hash or passkey keys.
        cur.execute("SELECT * FROM user_security WHERE user_id = ?", (user_id,))
        sec = row_to_dict(cur.fetchone()) or {}
        out["security"] = {k: v for k, v in sec.items() if k != "pin_hash"}
        out["passkeys"] = _rows(cur, "SELECT device_label, transports, created_at, last_used_at FROM user_credentials "
                                     "WHERE user_id = ?", (user_id,))
        out["sandbox_account"] = _rows(cur, "SELECT * FROM accounts WHERE user_id = ?", (user_id,))
        out["sandbox_ledger"] = _rows(cur, "SELECT * FROM ledger_entries WHERE user_id = ? ORDER BY id", (user_id,))
        out["audit_events"] = _rows(cur, "SELECT event_type, payload, created_at FROM audit_log WHERE user_id = ? "
                                         "ORDER BY id", (user_id,))
        for e in out["audit_events"]:
            e["payload"] = loads(e["payload"], {}) if e.get("payload") else {}
        out["snapshots"] = _snapshots(cur, user_id)
    from services import audit

    audit.record(audit.DATA_EXPORTED, user_id, institution_id=institution_id,
                 sections={k: len(v) if isinstance(v, list) else 1 for k, v in out.items()})
    return out


def _snapshots(cur, user_id: str) -> list[dict]:
    """Decision feature snapshots, when that table exists."""
    if not _columns(cur, "decision_features"):
        return []
    rows = _rows(cur, "SELECT * FROM decision_features WHERE user_id = ? ORDER BY created_at", (user_id,))
    for r in rows:
        if isinstance(r.get("features"), str):
            r["features"] = loads(r["features"], {})
    return rows


def erase(institution_id: str, user_id: str, by: str, confirm_reference: str) -> dict:
    """Remove what identifies one customer. `confirm_reference` must be the
    bank's own reference for them, typed by the person asking."""
    with cursor() as cur:
        cur.execute("SELECT * FROM customers WHERE id = ? AND institution_id = ?", (user_id, institution_id))
        customer = row_to_dict(cur.fetchone())
        if not customer:
            raise RightsError(404, "Customer not found.")
        if (confirm_reference or "").strip() != customer["external_ref"]:
            raise RightsError(400, "Type the customer's reference exactly to confirm.")
        cur.execute("SELECT COUNT(*) AS n FROM ghost_containers WHERE user_id = ? AND status IN ('HELD', "
                    "'RELEASE_REQUESTED')", (user_id,))
        if cur.fetchone()["n"]:
            raise RightsError(409, "This customer has a hold in progress. Release or cancel it first.")

        alias = ERASED_PREFIX + pysecrets.token_hex(8)
        counts: dict[str, int] = {}
        txids = [r["id"] for r in _rows(cur, "SELECT id FROM transactions WHERE user_id = ?", (user_id,))]

        # Decisions and holds stay, cut loose from the person.
        cleared = [c for c in _DECISION_PERSONAL if c in _columns(cur, "transactions")]
        cur.execute(f"UPDATE transactions SET user_id = ?, {', '.join(f'{c} = NULL' for c in cleared)} "
                    "WHERE user_id = ?", (alias, user_id))
        counts["decisions_anonymised"] = cur.rowcount
        cur.execute("UPDATE ghost_containers SET user_id = ?, recipient_id = NULL, recipient_account = NULL, "
                    "recipient_bank = NULL, explanation = NULL WHERE user_id = ?", (alias, user_id))
        counts["holds_anonymised"] = cur.rowcount
        if _columns(cur, "decision_features"):
            cur.execute("UPDATE decision_features SET user_id = ? WHERE user_id = ?", (alias, user_id))
            counts["snapshots_anonymised"] = cur.rowcount
        # Analysts' notes are free text that may name the customer.
        if txids:
            marks = ",".join("?" * len(txids))
            cur.execute(f"DELETE FROM case_notes WHERE transaction_id IN ({marks})", txids)
            counts["case_notes"] = cur.rowcount

        for table in _DELETE_BY_USER:
            if "user_id" in _columns(cur, table):
                cur.execute(f"DELETE FROM {table} WHERE user_id = ?", (user_id,))
                counts[table] = cur.rowcount

        # The customer's audit events stay as a record of what happened, under
        # the alias and without identifying details.
        for row in _rows(cur, "SELECT id, payload FROM audit_log WHERE user_id = ?", (user_id,)):
            payload = loads(row["payload"], {}) if row.get("payload") else {}
            if isinstance(payload, dict):
                payload = {k: v for k, v in payload.items() if k not in _AUDIT_PERSONAL}
            cur.execute("UPDATE audit_log SET user_id = ?, payload = ? WHERE id = ?",
                        (alias, json.dumps(payload), row["id"]))
        # Delivered or failed webhook payloads name the customer; pending ones
        # are still on their way to the bank and are left to finish.
        cur.execute("DELETE FROM webhook_outbox WHERE status IN ('delivered', 'failed') AND payload LIKE ?",
                    (f'%"{user_id}"%',))
        counts["webhook_payloads"] = cur.rowcount
        # Raw import rows can carry the reference, name, phone or email.
        cur.execute("DELETE FROM import_rows WHERE data LIKE ?", (f'%"{customer["external_ref"]}"%',))
        counts["import_rows"] = cur.rowcount
        cur.execute("DELETE FROM customers WHERE id = ?", (user_id,))

    # Proof for the bank, later, that this reference was erased, without
    # keeping the reference: a hash it can recompute.
    ref_hash = hashlib.sha256(f"{institution_id}:{customer['external_ref']}".encode()).hexdigest()
    from services import audit

    audit.record(audit.DATA_ERASED, alias, institution_id=institution_id, by=by, reference_sha256=ref_hash,
                 counts=counts)
    return {"erased": True, "alias": alias, "reference_sha256": ref_hash, "counts": counts}
