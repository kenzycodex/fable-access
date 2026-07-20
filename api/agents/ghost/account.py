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
from db import DEFAULT_INSTITUTION_ID, cursor, row_to_dict, dumps, loads


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
    signals: list[str] | None = None,
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
                institution_id, signals)
               VALUES (?, ?, ?, ?, ?, ?, 'HELD', ?, ?, ?, ?, ?, ?, ?)""",
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
                dumps(signals or []),
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

    # Nothing to reverse: holding reserved the funds without debiting them,
    # so cancelling just drops the reservation and the balance is untouched.
    return {
        "ghost_id": ghost_id,
        "status": "CANCELLED",
        "message": "Transfer cancelled. Your money is safe.",
    }


class StepUpRequired(Exception):
    """Release refused because the caller hasn't proved who they are.

    Carries the level demanded so the client can start the right flow.
    """

    def __init__(self, level: str, message: str):
        super().__init__(message)
        self.level = level


def release_ghost(ghost_id: str, user_id: str, stepup_token: str | None = None) -> dict:
    container = get_ghost_container(ghost_id)
    if not container:
        raise ValueError("Ghost container not found")
    if container["user_id"] != user_id:
        raise PermissionError("Unauthorized")
    if container["status"] != "HELD":
        raise ValueError(f"Container already resolved: {container['status']}")

    # The whole point of containment. Ghost holds money precisely because the
    # transfer looked wrong, so "release" is the most attacker-valuable button
    # in the product — and until now it was guarded only by a user_id the
    # client supplies about itself. An attacker holding the session could
    # simply press it. Releasing now costs a factor the session alone can't
    # produce; cancelling stays free, because returning money is always safe.
    from agents.shield import assurance, stepup as stepup_service

    signals = loads(container.get("signals"), []) if container.get("signals") else []
    required = assurance.release_level(container.get("risk_score") or 0.0, signals)
    proved = stepup_service.verify_token(stepup_token, user_id, "ghost_release", ghost_id)

    if not assurance.satisfies(proved, required):
        stepup_service.record_failure(user_id, "ghost_release", f"missing_{required}")
        raise StepUpRequired(
            required,
            "This transfer can't be released until you verify it's you.",
        )

    if stepup_token:
        stepup_service.consume_token(stepup_token)

    # The reservation becomes a real debit. Until this moment the money was
    # held but never taken, which is what made cancelling able to return it.
    from accounts import debit

    debit(
        user_id, container["amount"], container.get("institution_id"),
        transaction_id=ghost_id, reference=f"ghost-release:{ghost_id}",
    )

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
