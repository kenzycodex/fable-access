"""Fable Ghost — transaction containment layer.

When Shield flags a transfer HIGH risk but the user overrides, Ghost
routes it through a disposable container with a cooling window. Cancel
returns the funds; confirm releases them. For the hackathon MVP this is
simulated in SQLite — production wires this to the Open Banking
/accounts/{number}/holds endpoint.
"""
import uuid
from datetime import datetime, timedelta, timezone

from config import GHOST_COOLING_HIGH, GHOST_COOLING_MED, GHOST_COOLING_LOW
from db import DEFAULT_INSTITUTION_ID, cursor, row_to_dict, dumps


def calculate_cooling_window(risk_score: float) -> int:
    if risk_score >= 0.9:
        return GHOST_COOLING_HIGH
    elif risk_score >= 0.7:
        return GHOST_COOLING_MED
    return GHOST_COOLING_LOW


def create_ghost_container(
    user_id: str,
    transaction: dict,
    risk_score: float,
    explanation: str,
    institution_id: str | None = None,
) -> dict:
    ghost_id = f"ghost_{uuid.uuid4().hex[:12]}"
    cooling_minutes = calculate_cooling_window(risk_score)
    created_at = datetime.now(timezone.utc)
    expires_at = created_at + timedelta(minutes=cooling_minutes)

    with cursor() as cur:
        cur.execute(
            """INSERT INTO ghost_containers
               (ghost_id, user_id, amount, recipient_id, recipient_account, recipient_bank,
                status, cooling_window_minutes, risk_score, explanation, created_at, expires_at,
                institution_id)
               VALUES (?, ?, ?, ?, ?, ?, 'HELD', ?, ?, ?, ?, ?, ?)""",
            (
                ghost_id,
                user_id,
                transaction["amount"],
                transaction.get("recipient_id"),
                transaction.get("recipient_account"),
                transaction.get("recipient_bank"),
                cooling_minutes,
                risk_score,
                explanation,
                created_at.isoformat(),
                expires_at.isoformat(),
                institution_id or DEFAULT_INSTITUTION_ID,
            ),
        )

    return {
        "ghost_id": ghost_id,
        "status": "HELD",
        "amount": transaction["amount"],
        "recipient_account": transaction.get("recipient_account"),
        "recipient_bank": transaction.get("recipient_bank"),
        "message": f"Your ₦{transaction['amount']:,.0f} is held safely. You have {cooling_minutes} minutes to confirm or cancel.",
        "cooling_window_minutes": cooling_minutes,
        "created_at": created_at.isoformat(),
        "expires_at": expires_at.isoformat(),
        "risk_score": risk_score,
        "explanation": explanation,
    }


def get_ghost_container(ghost_id: str) -> dict | None:
    with cursor() as cur:
        cur.execute("SELECT * FROM ghost_containers WHERE ghost_id = ?", (ghost_id,))
        row = cur.fetchone()
    return row_to_dict(row)


def cancel_ghost(ghost_id: str, user_id: str) -> dict:
    container = get_ghost_container(ghost_id)
    if not container:
        raise ValueError("Ghost container not found")
    if container["user_id"] != user_id:
        raise PermissionError("Unauthorized")
    if container["status"] != "HELD":
        raise ValueError(f"Container already resolved: {container['status']}")

    with cursor() as cur:
        cur.execute(
            "UPDATE ghost_containers SET status = 'CANCELLED', resolved_at = ? WHERE ghost_id = ?",
            (datetime.now(timezone.utc).isoformat(), ghost_id),
        )

    return {
        "ghost_id": ghost_id,
        "status": "CANCELLED",
        "message": "Transfer cancelled. Your money is safe.",
    }


def release_ghost(ghost_id: str, user_id: str) -> dict:
    container = get_ghost_container(ghost_id)
    if not container:
        raise ValueError("Ghost container not found")
    if container["user_id"] != user_id:
        raise PermissionError("Unauthorized")
    if container["status"] != "HELD":
        raise ValueError(f"Container already resolved: {container['status']}")

    with cursor() as cur:
        cur.execute(
            "UPDATE ghost_containers SET status = 'RELEASED', resolved_at = ? WHERE ghost_id = ?",
            (datetime.now(timezone.utc).isoformat(), ghost_id),
        )

    return {
        "ghost_id": ghost_id,
        "status": "RELEASED",
        "message": f"Transfer released. Sending ₦{container['amount']:,.0f} to the recipient.",
    }
