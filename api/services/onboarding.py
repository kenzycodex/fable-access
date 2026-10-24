"""What an institution still has to do before it goes live.

Every item is worked out from the institution's real state, not ticked by
hand, except the agreements, which an owner confirms explicitly. Going live is
refused until every required item is done.
"""
from __future__ import annotations

from core.db import cursor


def _one(sql: str, *args) -> int:
    with cursor() as cur:
        cur.execute(sql, args)
        row = cur.fetchone()
    return int(row[0] or 0) if row else 0


def checklist(institution_id: str) -> dict:
    with cursor() as cur:
        cur.execute(
            "SELECT mode, status, agreements_confirmed_at, agreements_confirmed_by FROM institutions WHERE institution_id = ?",
            (institution_id,),
        )
        inst = cur.fetchone()

    branded = _one(
        """SELECT COUNT(*) FROM institution_branding WHERE institution_id = ?
             AND (logo_url IS NOT NULL OR display_name IS NOT NULL)""",
        institution_id,
    )
    members = _one("SELECT COUNT(*) FROM admins WHERE institution_id = ? AND COALESCE(active, 1) = 1", institution_id)
    keys = _one("SELECT COUNT(*) FROM api_keys WHERE institution_id = ? AND is_active = 1", institution_id)
    tested_hooks = _one(
        """SELECT COUNT(DISTINCT w.id) FROM webhooks w
             JOIN webhook_deliveries d ON d.webhook_id = w.id AND d.ok = 1
            WHERE w.institution_id = ? AND w.active = 1""",
        institution_id,
    )
    policy = _one("SELECT COUNT(*) FROM institution_settings WHERE institution_id = ?", institution_id)
    real_customers = _one(
        "SELECT COUNT(*) FROM customers WHERE institution_id = ? AND kind = 'real'", institution_id,
    )
    history = _one("SELECT COUNT(*) FROM transaction_history WHERE institution_id = ?", institution_id)

    items = [
        {"key": "agreements", "label": "Confirm the data processing agreement and the DPIA", "required": True,
         "done": bool(inst and inst["agreements_confirmed_at"]),
         "detail": "Fable processes your customers' data on your behalf under the NDPA 2023. An owner confirms both are in place."},
        {"key": "api_key", "label": "Create an API key", "required": True, "done": keys > 0,
         "detail": "Your servers send it with every request once you are live."},
        {"key": "webhook", "label": "Add a webhook and send a test event", "required": True, "done": tested_hooks > 0,
         "detail": "So your systems hear about blocks, holds and resolved cases."},
        {"key": "policy", "label": "Review your risk thresholds", "required": True, "done": policy > 0,
         "detail": "Save your flag and block thresholds and hold windows, even if you keep the defaults."},
        {"key": "customers", "label": "Import your customers", "required": True, "done": real_customers > 0,
         "detail": "Real customers by your own reference. Test customers don't count."},
        {"key": "history", "label": "Import past transfers", "required": False, "done": history > 0,
         "detail": "Recommended: without history, every customer starts with no baseline."},
        {"key": "team", "label": "Invite your fraud team", "required": False, "done": members > 1,
         "detail": "Analysts work the review queue; viewers can only read."},
        {"key": "branding", "label": "Add your name and logo", "required": False, "done": branded > 0,
         "detail": "Shown in your console and your sandbox app."},
    ]
    required_left = [i["key"] for i in items if i["required"] and not i["done"]]
    return {
        "institution_id": institution_id,
        "mode": (inst["mode"] if inst else None) or "sandbox",
        "ready_to_go_live": not required_left,
        "required_remaining": required_left,
        "done": sum(1 for i in items if i["done"]),
        "total": len(items),
        "items": items,
        "agreements": {
            "confirmed_at": inst["agreements_confirmed_at"] if inst else None,
            "confirmed_by": inst["agreements_confirmed_by"] if inst else None,
        },
    }
