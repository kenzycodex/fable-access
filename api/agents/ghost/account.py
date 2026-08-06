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


def sweep_expired() -> int:
    """Auto-cancel holds whose cooling window has closed.

    Cancel rather than release, because cancelling returns the money and
    releasing moves it: if the customer never came back to confirm, the safe
    reading of their silence is that they did not want the transfer. That is
    also the direction the product's whole argument points — a scam victim who
    walks away should end up with their money, not without it.

    Runs at startup and can be called on a schedule. Idempotent: only rows
    still in HELD are touched.
    """
    with cursor() as cur:
        cur.execute(
            "UPDATE ghost_containers SET status = 'CANCELLED', resolved_at = datetime('now') "
            "WHERE status = 'HELD' AND expires_at IS NOT NULL "
            "  AND datetime(expires_at) <= datetime('now')",
        )
        return cur.rowcount


def has_expired(container: dict) -> bool:
    """Whether the cooling window has closed.

    `expires_at` was written on every container and then never read anywhere in
    the API: no expiry check on release, no sweeper, nothing. The countdown was
    a UI animation with no server-side existence, which meant a container could
    be released days later and an abandoned one suppressed the customer's
    available balance permanently.
    """
    raw = container.get("expires_at")
    if not raw:
        return False
    try:
        expires = datetime.fromisoformat(str(raw))
    except (TypeError, ValueError):
        return False
    # Seeded rows are written naive; live ones carry an offset. Comparing the
    # two raises, so normalise before comparing.
    if expires.tzinfo is None:
        expires = expires.replace(tzinfo=timezone.utc)
    return expires <= datetime.now(timezone.utc)


def _resolve(ghost_id: str, status: str) -> bool:
    """Move a container out of HELD, atomically.

    The status was read and then updated in a separate statement, so a
    concurrent cancel and release could both pass the `status != HELD` check.
    Guarding on the current status inside the UPDATE means exactly one of them
    wins, and the loser can be told what actually happened.
    """
    with cursor() as cur:
        cur.execute(
            "UPDATE ghost_containers SET status = ?, resolved_at = ? "
            "WHERE ghost_id = ? AND status = 'HELD'",
            (status, datetime.now(timezone.utc).isoformat(), ghost_id),
        )
        return cur.rowcount > 0


def cancel_ghost(ghost_id: str, user_id: str) -> dict:
    container = get_ghost_container(ghost_id)
    if not container:
        raise ValueError("Ghost container not found")
    if container["user_id"] != user_id:
        raise PermissionError("Unauthorized")

    # Deliberately still allowed after expiry. Cancelling returns money to the
    # customer, so it is always the safe direction; refusing it would strand
    # funds to enforce a deadline that exists to protect them.
    if not _resolve(ghost_id, "CANCELLED"):
        current = (get_ghost_container(ghost_id) or {}).get("status")
        raise ValueError(f"Container already resolved: {current}")

    # Nothing to reverse: holding reserved the funds without debiting them,
    # so cancelling just drops the reservation and the balance is untouched.
    return {
        "ghost_id": ghost_id,
        "status": "CANCELLED",
        "message": "Transfer cancelled. Your money is safe.",
    }


class ExpiredContainer(Exception):
    """Release refused because the cooling window has closed.

    Cancelling is still permitted, because returning money is always the safe
    direction.
    """


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

    # The cooling window is a deadline, not decoration. It existed only as a
    # timestamp nothing read, so a container could be released days after the
    # window it was supposedly protected by had closed.
    if has_expired(container):
        raise ExpiredContainer(
            "This hold has expired. Cancel it and start the transfer again."
        )

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

    # Status first, and only if this call is the one that wins the race. Debiting
    # before the transition meant two concurrent releases could both debit; the
    # ledger's idempotency reference caught that, but relying on a downstream
    # guard for a correctness property this function owns is the wrong shape.
    if not _resolve(ghost_id, "RELEASED"):
        current = (get_ghost_container(ghost_id) or {}).get("status")
        raise ValueError(f"Container already resolved: {current}")

    # The reservation becomes a real debit. Until this moment the money was
    # held but never taken, which is what made cancelling able to return it.
    from accounts import debit

    debit(
        user_id, container["amount"], container.get("institution_id"),
        transaction_id=ghost_id, reference=f"ghost-release:{ghost_id}",
    )

    return {
        "ghost_id": ghost_id,
        "status": "RELEASED",
        "message": f"Transfer released. Sending ₦{container['amount']:,.0f} to the recipient.",
    }
