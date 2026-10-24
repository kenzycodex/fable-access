"""Deleting what Fable no longer needs, on a schedule.

Run by the scheduler every few hours (job "retention"); safe to run anywhere,
any number of times. Each step deletes or clears rows older than its limit:

  decisions, imported history, holds, notifications, snapshots
      after FABLE_RETENTION_DAYS (5 years by default and at least, the
      record-keeping period Nigerian banks must keep to). The bank keeps its own records of the transfers.
  behavioural, device, location and IP detail on decisions; the location trail
      after FABLE_RETENTION_DETAIL_DAYS (2 years by default). The decision keeps
      its amount, outcome, recipient and score. The recipient stays because
      recipient memory (up to 3 years) reads it.
  uploaded import rows never applied            after 7 days
  sandbox inbox                                 after 30 days
  used or expired step-up challenges and tokens after 1 day
  delivered webhook events                      after 30 days

The audit log is kept: it is the record of who did what, and an erased
customer's events in it carry no identifying details (services/data_rights.py).
"""
from __future__ import annotations

import logging

from core.db import cursor

logger = logging.getLogger("fable.retention")

DETAIL_COLUMNS = (
    "device_fingerprint", "client_ip", "latitude", "longitude", "city", "country", "location_source",
    "session_duration_seconds", "auth_method", "typing_speed_ms", "paste_detected", "time_to_submit_seconds",
    "client_timestamp", "client_timezone",
)


# Transaction records are kept at least 5 years (Nigeria's money laundering
# rules require banks to keep them that long). Enforced here as well as in the
# setting's bounds, so a value set in the environment cannot go lower either.
MIN_KEEP_DAYS = 1825


def _limits() -> tuple[int, int]:
    from core.secrets import setting

    return max(int(setting("FABLE_RETENTION_DAYS")), MIN_KEEP_DAYS), int(setting("FABLE_RETENTION_DETAIL_DAYS"))


def _table_columns(cur, table: str) -> set[str]:
    cur.execute(f"PRAGMA table_info({table})")
    return {r[1] for r in cur.fetchall()}


def apply(now_modifier: str = "now") -> dict:
    """One pass. Returns how many rows each step touched."""
    keep_days, detail_days = _limits()
    done: dict[str, int] = {}
    with cursor() as cur:
        old = f"datetime(created_at) < datetime('{now_modifier}', '-{keep_days} days')"
        for table in ("transactions", "transaction_history", "ghost_containers", "notifications", "decision_features"):
            if not _table_columns(cur, table):
                continue
            if table == "transactions":
                # Analysts' notes go with the decisions they were written on.
                cur.execute(f"DELETE FROM case_notes WHERE transaction_id IN (SELECT id FROM transactions WHERE {old})")
                done["case_notes"] = cur.rowcount
            cur.execute(f"DELETE FROM {table} WHERE {old}")
            done[table] = cur.rowcount

        detail_old = f"datetime(created_at) < datetime('{now_modifier}', '-{detail_days} days')"
        cols = [c for c in DETAIL_COLUMNS if c in _table_columns(cur, "transactions")]
        cur.execute(f"UPDATE transactions SET {', '.join(f'{c} = NULL' for c in cols)} "
                    f"WHERE {detail_old} AND (device_fingerprint IS NOT NULL OR client_ip IS NOT NULL "
                    "OR latitude IS NOT NULL OR city IS NOT NULL OR typing_speed_ms IS NOT NULL)")
        done["decision_detail_cleared"] = cur.rowcount
        cur.execute(f"DELETE FROM user_locations WHERE datetime(seen_at) < datetime('{now_modifier}', '-{detail_days} days')")
        done["user_locations"] = cur.rowcount

        cur.execute(f"""DELETE FROM import_rows WHERE job_id IN (
                          SELECT id FROM import_jobs WHERE status != 'applying'
                            AND datetime(created_at) < datetime('{now_modifier}', '-7 days'))""")
        done["import_rows"] = cur.rowcount
        cur.execute(f"DELETE FROM sandbox_inbox WHERE datetime(created_at) < datetime('{now_modifier}', '-30 days')")
        done["sandbox_inbox"] = cur.rowcount
        for table in ("stepup_challenges", "stepup_tokens"):
            if "expires_at" in _table_columns(cur, table):
                cur.execute(f"DELETE FROM {table} WHERE datetime(expires_at) < datetime('{now_modifier}', '-1 day')")
                done[table] = cur.rowcount
        cur.execute(f"DELETE FROM webhook_outbox WHERE status = 'delivered' "
                    f"AND datetime(created_at) < datetime('{now_modifier}', '-30 days')")
        done["webhook_outbox"] = cur.rowcount

    touched = {k: v for k, v in done.items() if v}
    if touched:
        from services import audit

        audit.record(audit.RETENTION_APPLIED, None, keep_days=keep_days, detail_days=detail_days, rows=touched)
        logger.info("Retention removed or cleared: %s", touched)
    return done
