"""Fable Ghost: holding a risky transfer for a cooling window.

When Shield blocks a transfer (or flags one, where the bank's policy allows)
and the customer still wants it sent, Ghost holds it for a short window in
which the customer can cancel and keep the money, or release it with a
stronger proof that it is them.

Every hold is opened from a decision Fable stored. Its risk score, signals and
explanation are copied from that decision, never taken from the caller: those
values decide how long the hold lasts and how strong the release proof must
be, so a caller who could set them could shorten the window and weaken the
check.

States: HELD, optionally RELEASE_REQUESTED (the customer cannot produce the
proof a release needs and has asked their bank to verify them instead), then
exactly one of RELEASED, CANCELLED or EXPIRED. Every move is a single guarded
UPDATE, so of two racing actions exactly one wins, and every move is audited,
sent as a webhook and told to the customer.

Where the money is: in the sandbox, Fable's simulated ledger reserves the
amount while it is held and debits it only on release. A live bank keeps the
money in its own core banking system. Fable moves nothing; the bank holds the
funds when it receives containment.created and acts on containment.released,
containment.cancelled or containment.expired.
"""
import logging
import uuid
from datetime import datetime, timedelta, timezone

from core.db import cursor, dumps, loads, require_institution_id, row_to_dict
from core.secrets import setting

logger = logging.getLogger("fable.ghost")

HELD, RELEASED, CANCELLED, EXPIRED = "HELD", "RELEASED", "CANCELLED", "EXPIRED"
RELEASE_REQUESTED = "RELEASE_REQUESTED"
# Still holding the money.
ACTIVE = (HELD, RELEASE_REQUESTED)
_ACTIVE_SQL = "('HELD', 'RELEASE_REQUESTED')"

# A hold that expired longer ago than this (because the API was down when its
# window closed) is expired quietly: an alert about a transfer from hours ago
# helps nobody and alarms the customer.
ANNOUNCE_EXPIRY_WITHIN = timedelta(hours=1)


class HoldError(ValueError):
    """A hold that cannot be opened or changed, with a message for the caller."""

    def __init__(self, message: str, status: int = 409, code: str = "hold_refused"):
        super().__init__(message)
        self.status = status
        self.code = code


def calculate_cooling_window(risk_score: float, institution_id: str | None = None) -> int:
    """How long Ghost holds a transfer: the institution's policy, or the defaults."""
    if institution_id:
        from services.policy import cooling_minutes

        return cooling_minutes(institution_id, risk_score)
    if risk_score >= 0.9:
        return setting("GHOST_COOLING_HIGH")
    elif risk_score >= 0.7:
        return setting("GHOST_COOLING_MED")
    return setting("GHOST_COOLING_LOW")


def holdable_actions(institution_id: str | None) -> set[str]:
    """Which decisions a customer may route into a hold. Blocks always; flags
    only where the bank has chosen that (policy hold_on_flag)."""
    from services.policy import effective

    actions = {"BLOCK"}
    if institution_id and effective(institution_id).get("hold_on_flag"):
        actions.add("FLAG")
    return actions


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _signal_codes(raw) -> list[str]:
    return [str(s) for s in (loads(raw, []) if isinstance(raw, str) else (raw or []))]


def _public(container: dict) -> dict:
    out = dict(container)
    out["signals"] = _signal_codes(container.get("signals"))
    return out


def create_ghost_container(
    user_id: str,
    transaction: dict,
    risk_score: float,
    explanation: str,
    institution_id: str | None = None,
    signals: list[str] | None = None,
    transaction_id: str | None = None,
) -> dict:
    """Write a HELD container. Callers pass values from a stored decision."""
    ghost_id = f"ghost_{uuid.uuid4().hex[:12]}"
    cooling_minutes = calculate_cooling_window(risk_score, institution_id)
    created_at = _now()
    expires_at = created_at + timedelta(minutes=cooling_minutes)

    with cursor() as cur:
        cur.execute(
            """INSERT INTO ghost_containers
               (ghost_id, user_id, amount, recipient_id, recipient_account, recipient_bank,
                status, cooling_window_minutes, risk_score, explanation, created_at, expires_at,
                institution_id, signals, transaction_id)
               VALUES (?, ?, ?, ?, ?, ?, 'HELD', ?, ?, ?, ?, ?, ?, ?, ?)""",
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
                require_institution_id(institution_id),
                dumps(signals or []),
                transaction_id,
            ),
        )

    return {
        "ghost_id": ghost_id,
        "transaction_id": transaction_id,
        "status": HELD,
        "amount": transaction["amount"],
        "recipient_account": transaction.get("recipient_account"),
        "recipient_bank": transaction.get("recipient_bank"),
        "message": f"Your ₦{transaction['amount']:,.0f} is held safely. You have {cooling_minutes} minutes to confirm or cancel.",
        "cooling_window_minutes": cooling_minutes,
        "created_at": created_at.isoformat(),
        "expires_at": expires_at.isoformat(),
        "risk_score": risk_score,
        "explanation": explanation,
        "signals": list(signals or []),
    }


def _decision(transaction_id: str, user_id: str, institution_id: str) -> dict | None:
    with cursor() as cur:
        cur.execute("SELECT * FROM transactions WHERE id = ? AND user_id = ? AND institution_id = ?",
                    (transaction_id, user_id, institution_id))
        return row_to_dict(cur.fetchone())


def find_decision(user_id: str, institution_id: str, amount: float, recipient_account: str | None,
                  within_minutes: int | None = None) -> str | None:
    """The stored decision an older client means when it opens a hold without
    naming one: this customer's latest unresolved block (or flag) for the same
    amount and recipient, made recently (GHOST_LEGACY_MATCH_MINUTES)."""
    if within_minutes is None:
        within_minutes = int(setting("GHOST_LEGACY_MATCH_MINUTES"))
    with cursor() as cur:
        cur.execute(
            """SELECT id FROM transactions
               WHERE user_id = ? AND institution_id = ? AND action_taken IN ('BLOCK', 'FLAG')
                 AND ABS(amount - ?) < 0.005 AND COALESCE(recipient_account, '') = COALESCE(?, '')
                 AND COALESCE(status, '') NOT IN ('completed', 'released', 'held', 'cancelled', 'expired')
                 AND datetime(created_at) >= datetime('now', ?)
               ORDER BY datetime(created_at) DESC LIMIT 1""",
            (user_id, institution_id, amount, recipient_account or "", f"-{int(within_minutes)} minutes"),
        )
        row = cur.fetchone()
    return row["id"] if row else None


def open_hold(transaction_id: str, user_id: str, institution_id: str) -> tuple[dict, bool]:
    """Open a hold from a stored decision. (container, created).

    Idempotent: a decision already held returns its hold rather than holding
    the money twice.
    """
    row = _decision(transaction_id, user_id, institution_id)
    if not row:
        raise HoldError("Transfer not found.", status=404, code="not_found")
    action = row.get("action_taken") or "PASS"
    if action not in holdable_actions(institution_id):
        raise HoldError(
            "Only a blocked transfer can be held." if action != "FLAG"
            else "This bank verifies flagged transfers instead of holding them.",
            code="not_holdable",
        )

    with cursor() as cur:
        cur.execute("SELECT * FROM ghost_containers WHERE transaction_id = ? ORDER BY created_at DESC LIMIT 1",
                    (transaction_id,))
        existing = row_to_dict(cur.fetchone())
    if existing:
        return get_ghost_container(existing["ghost_id"]) or _public(existing), False
    if row.get("status") in ("completed", "released", "cancelled"):
        raise HoldError("This transfer has already been settled.", code="settled")

    container = create_ghost_container(
        user_id,
        {"amount": row["amount"], "recipient_id": row.get("recipient_id"),
         "recipient_account": row.get("recipient_account"), "recipient_bank": row.get("recipient_bank")},
        float(row.get("risk_score") or 0.0),
        row.get("explanation") or "",
        institution_id,
        _signal_codes(row.get("shield_signals")),
        transaction_id=transaction_id,
    )
    with cursor() as cur:
        cur.execute("UPDATE transactions SET status = 'held' WHERE id = ?", (transaction_id,))

    from services import audit, webhooks

    audit.record(audit.CONTAINMENT_CREATED, user_id, ghost_id=container["ghost_id"], transaction_id=transaction_id,
                 amount=row["amount"], risk_score=row.get("risk_score"), institution_id=institution_id)
    webhooks.emit(institution_id, "containment.created", {
        "ghost_id": container["ghost_id"],
        "transaction_id": transaction_id,
        "user_id": user_id,
        "amount": row["amount"],
        "recipient_account": row.get("recipient_account"),
        "recipient_bank": row.get("recipient_bank"),
        "risk_score": row.get("risk_score"),
        "cooling_window_minutes": container["cooling_window_minutes"],
        "expires_at": container["expires_at"],
    })
    return container, True


def get_ghost_container(ghost_id: str) -> dict | None:
    """The hold, with its expiry applied if the window has closed: whoever
    reads a hold sees its true state, even if the expiry job has not run."""
    with cursor() as cur:
        cur.execute("SELECT * FROM ghost_containers WHERE ghost_id = ?", (ghost_id,))
        row = row_to_dict(cur.fetchone())
    if row and row["status"] in ACTIVE and has_expired(row):
        expire_hold(ghost_id)
        with cursor() as cur:
            cur.execute("SELECT * FROM ghost_containers WHERE ghost_id = ?", (ghost_id,))
            row = row_to_dict(cur.fetchone())
    return _public(row) if row else None


def has_expired(container: dict) -> bool:
    """Whether the cooling window has closed."""
    raw = container.get("expires_at")
    if not raw:
        return False
    try:
        expires = datetime.fromisoformat(str(raw).replace(" ", "T"))
    except (TypeError, ValueError):
        return False
    # Seeded rows are written naive; live ones carry an offset. Comparing the
    # two raises, so normalise before comparing.
    if expires.tzinfo is None:
        expires = expires.replace(tzinfo=timezone.utc)
    return expires <= _now()


def _resolve(ghost_id: str, status: str, by: str, note: str | None = None, only_if_expired: bool = False) -> bool:
    """Move a container out of HELD, atomically.

    Guarding on the current status inside the UPDATE means exactly one of two
    racing actions wins, and the loser can be told what actually happened.
    """
    expiry = " AND datetime(expires_at) <= datetime('now')" if only_if_expired else ""
    with cursor() as cur:
        cur.execute(
            "UPDATE ghost_containers SET status = ?, resolved_at = ?, resolved_by = ?, resolution_note = ? "
            f"WHERE ghost_id = ? AND status IN {_ACTIVE_SQL}{expiry}",
            (status, _now().isoformat(), by, (note or "")[:500] or None, ghost_id),
        )
        return cur.rowcount > 0


_TXN_STATUS = {RELEASED: "released", CANCELLED: "cancelled", EXPIRED: "expired"}
_EVENT = {RELEASED: "containment.released", CANCELLED: "containment.cancelled", EXPIRED: "containment.expired"}


def _settled(container: dict, status: str, by: str, note: str | None = None, announce: bool = True) -> None:
    """Everything that follows a hold ending: the transfer's status, the audit
    trail, the bank's webhook and the customer's notification. With announce
    off (a long-stale expiry) only the status and the audit row are written."""
    from services import audit, notifications, webhooks

    txid = container.get("transaction_id")
    if txid:
        with cursor() as cur:
            # A release is the customer saying "this was really me", which is
            # what the baselines learn from; a cancel or expiry teaches nothing.
            cur.execute("UPDATE transactions SET status = ?, confirmed_legitimate = ? WHERE id = ?",
                        (_TXN_STATUS[status], 1 if status == RELEASED else 0, txid))
    event = {RELEASED: audit.CONTAINMENT_RELEASED, CANCELLED: audit.CONTAINMENT_CANCELLED,
             EXPIRED: audit.CONTAINMENT_EXPIRED}[status]
    audit.record(event, container.get("user_id"), ghost_id=container.get("ghost_id"), transaction_id=txid,
                 amount=container.get("amount"), by=by, note=note, institution_id=container.get("institution_id"),
                 announced=announce)
    if not announce:
        return
    data = {
        "ghost_id": container.get("ghost_id"),
        "transaction_id": txid,
        "user_id": container.get("user_id"),
        "amount": container.get("amount"),
        "status": status,
        "resolved_by": by,
    }
    webhooks.emit(container.get("institution_id"), _EVENT[status], data)
    webhooks.emit(container.get("institution_id"), "containment.resolved",
                  {**data, "outcome": _TXN_STATUS[status]})
    try:
        notifications.notify_hold_ended(container.get("user_id"), container.get("institution_id"),
                                        container.get("ghost_id"), container.get("amount") or 0, status, by)
    except Exception as exc:  # noqa: BLE001 - a notification must never undo the outcome
        logger.warning("Could not notify the customer about hold %s: %s", container.get("ghost_id"), exc)


def expire_hold(ghost_id: str) -> bool:
    """End a hold whose window has closed. The money stays with the customer:
    if they never came back to confirm, the safe reading of their silence is
    that they did not want the transfer.

    A hold whose window closed more than ANNOUNCE_EXPIRY_WITHIN ago (the API was
    down) is expired quietly: state and audit only, no webhook or alert."""
    with cursor() as cur:
        cur.execute("SELECT * FROM ghost_containers WHERE ghost_id = ?", (ghost_id,))
        container = row_to_dict(cur.fetchone())
    if not container or not _resolve(ghost_id, EXPIRED, "expiry", only_if_expired=True):
        return False
    expired_at = None
    try:
        expired_at = datetime.fromisoformat(str(container.get("expires_at")).replace(" ", "T"))
        if expired_at.tzinfo is None:
            expired_at = expired_at.replace(tzinfo=timezone.utc)
    except (TypeError, ValueError):
        pass
    announce = expired_at is None or _now() - expired_at <= ANNOUNCE_EXPIRY_WITHIN
    _settled(container, EXPIRED, "expiry", announce=announce)
    return True


def sweep_expired() -> int:
    """Expire every hold whose window has closed. Idempotent; run by the
    scheduler every half minute and once at startup."""
    with cursor() as cur:
        cur.execute(
            f"SELECT ghost_id FROM ghost_containers WHERE status IN {_ACTIVE_SQL} AND expires_at IS NOT NULL "
            "AND datetime(expires_at) <= datetime('now') LIMIT 500"
        )
        ids = [r["ghost_id"] for r in cur.fetchall()]
    return sum(1 for gid in ids if expire_hold(gid))


def request_release(ghost_id: str, user_id: str) -> dict:
    """The customer cannot produce the proof a release needs, and asks their
    bank to verify them another way (a call to the number on file, a branch).

    The hold stays in place, its window is extended so staff have time to act
    (GHOST_RELEASE_REQUEST_HOURS), and the case reopens in the console review
    queue. Only bank staff can then release it, with a note.
    """
    container = get_ghost_container(ghost_id)
    if not container:
        raise HoldError("Hold not found.", status=404, code="not_found")
    if container["user_id"] != user_id:
        raise HoldError("Hold not found.", status=404, code="not_found")
    if container["status"] == RELEASE_REQUESTED:
        return container
    if container["status"] != HELD:
        raise HoldError(f"This hold has already ended: {container['status'].lower()}.", code="resolved")
    hours = int(setting("GHOST_RELEASE_REQUEST_HOURS"))
    until = (_now() + timedelta(hours=hours)).isoformat()
    with cursor() as cur:
        cur.execute(
            "UPDATE ghost_containers SET status = 'RELEASE_REQUESTED', "
            "expires_at = CASE WHEN datetime(expires_at) > datetime(?) THEN expires_at ELSE ? END "
            "WHERE ghost_id = ? AND status = 'HELD'",
            (until, until, ghost_id),
        )
        moved = cur.rowcount > 0
        if moved and container.get("transaction_id"):
            # Back to the top of the bank's review queue.
            cur.execute("UPDATE transactions SET review_state = 'open', review_outcome = NULL WHERE id = ?",
                        (container["transaction_id"],))
    if not moved:
        current = (get_ghost_container(ghost_id) or {}).get("status")
        raise HoldError(f"This hold has already ended: {str(current).lower()}.", code="resolved")

    from services import audit, notifications, webhooks

    audit.record(audit.CONTAINMENT_RELEASE_REQUESTED, user_id, ghost_id=ghost_id,
                 transaction_id=container.get("transaction_id"), amount=container.get("amount"),
                 institution_id=container.get("institution_id"))
    webhooks.emit(container.get("institution_id"), "containment.release_requested", {
        "ghost_id": ghost_id, "transaction_id": container.get("transaction_id"), "user_id": user_id,
        "amount": container.get("amount"), "expires_at": until,
    })
    try:
        notifications.notify_release_requested(user_id, container.get("institution_id"), ghost_id,
                                               container.get("amount") or 0, hours)
    except Exception as exc:  # noqa: BLE001 - a notification must never undo the request
        logger.warning("Could not notify the customer about release request %s: %s", ghost_id, exc)
    return get_ghost_container(ghost_id) or {}


def cancel_ghost(ghost_id: str, user_id: str, by: str = "customer", note: str | None = None) -> dict:
    container = get_ghost_container(ghost_id)
    if not container:
        raise ValueError("Ghost container not found")
    if container["user_id"] != user_id:
        raise PermissionError("Unauthorized")
    if container["status"] == EXPIRED:
        # Nothing to do: an expired hold already gave the money back.
        return {"ghost_id": ghost_id, "status": EXPIRED,
                "message": "This hold had already ended. Your money is safe."}
    if not _resolve(ghost_id, CANCELLED, by, note):
        current = (get_ghost_container(ghost_id) or {}).get("status")
        raise ValueError(f"Container already resolved: {current}")
    _settled(container, CANCELLED, by, note)
    # Nothing to reverse: holding reserved the funds without debiting them,
    # so cancelling just drops the reservation and the balance is untouched.
    return {
        "ghost_id": ghost_id,
        "status": CANCELLED,
        "message": "Transfer cancelled. Your money is safe.",
    }


class ExpiredContainer(Exception):
    """Release refused because the cooling window has closed."""


class StepUpRequired(Exception):
    """Release refused because the caller hasn't proved who they are.

    Carries the level demanded so the client can start the right flow.
    """

    def __init__(self, level: str, message: str):
        super().__init__(message)
        self.level = level


def _debit_if_sandbox(container: dict, user_id: str) -> None:
    """In the sandbox the reservation becomes a real debit on Fable's simulated
    ledger. A live bank keeps the money in its own systems: the release tells
    it to submit the transfer, and Fable moves nothing."""
    from core.tenancy import institution_mode

    if institution_mode(container.get("institution_id")) != "live":
        from services.accounts import debit

        debit(
            user_id, container["amount"], container.get("institution_id"),
            transaction_id=container.get("transaction_id") or container["ghost_id"],
            reference=f"ghost-release:{container['ghost_id']}",
        )
        if container.get("transaction_id"):
            from services import forge_bridge

            forge_bridge.mirror_later(container["transaction_id"])


def release_ghost(ghost_id: str, user_id: str, stepup_token: str | None = None) -> dict:
    container = get_ghost_container(ghost_id)
    if not container:
        raise ValueError("Ghost container not found")
    if container["user_id"] != user_id:
        raise PermissionError("Unauthorized")
    if container["status"] == EXPIRED:
        raise ExpiredContainer("This hold has expired, so the money stayed with you. Start the transfer again.")
    if container["status"] not in ACTIVE:
        raise ValueError(f"Container already resolved: {container['status']}")
    if has_expired(container):
        raise ExpiredContainer("This hold has expired. Start the transfer again.")

    # The whole point of containment. Releasing costs a factor the session
    # alone can't produce; cancelling stays free, because returning money is
    # always safe.
    from agents.shield import assurance
    from agents.shield import stepup as stepup_service

    signals = _signal_codes(container.get("signals"))
    required = assurance.release_level(container.get("risk_score") or 0.0, signals)
    info = stepup_service.token_info(stepup_token, user_id, "ghost_release", ghost_id)
    proved = info["level"] if info else None

    if not assurance.satisfies(proved, required):
        stepup_service.record_failure(user_id, "ghost_release", f"missing_{required}")
        raise StepUpRequired(
            required,
            "This transfer can't be released until you verify it's you.",
        )

    # A factor set up after the money was held proves nothing about who the
    # customer is: an attacker holding the session can create one. The same
    # goes for a code sent to an email that was only just added.
    created = stepup_service._parse_time(container.get("created_at"))
    fresh_ok, late = stepup_service.factors_predate(info["factors"], created, user_id)
    if not fresh_ok:
        stepup_service.record_failure(user_id, "ghost_release", "factor_after_hold")
        raise StepUpRequired(
            required,
            "A factor set up after this transfer was held can't release it. You can still cancel it.",
        )

    if not stepup_service.consume_token(stepup_token):
        raise StepUpRequired(required, "That verification was already used. Verify again.")

    if not _resolve(ghost_id, RELEASED, "customer", f"verified: {proved}"):
        current = (get_ghost_container(ghost_id) or {}).get("status")
        raise ValueError(f"Container already resolved: {current}")

    _debit_if_sandbox(container, user_id)
    _settled(container, RELEASED, "customer", f"verified: {proved}")

    return {
        "ghost_id": ghost_id,
        "status": RELEASED,
        "message": f"Transfer released. Sending ₦{container['amount']:,.0f} to the recipient.",
    }


def staff_resolve(ghost_id: str, institution_id: str, action: str, actor: str, note: str) -> dict:
    """A bank staff member ends a hold from the console.

    Cancelling returns the money and is always allowed. Releasing sends it and
    is for when the bank has confirmed with the customer by its own means (a
    call to the number on file, a visit to a branch); it needs an owner (or an
    analyst, where the bank's policy allows) and a written note, and is audited
    under the staff member's name. The router checks the role.
    """
    container = get_ghost_container(ghost_id)
    if not container or container.get("institution_id") != institution_id:
        raise HoldError("Hold not found.", status=404, code="not_found")
    note = (note or "").strip()
    if action == "release" and len(note) < 10:
        raise HoldError("Say how the customer confirmed this transfer (at least 10 characters).", status=422,
                        code="note_required")
    if container["status"] not in ACTIVE:
        raise HoldError(f"This hold has already ended: {container['status'].lower()}.", code="resolved")
    status = RELEASED if action == "release" else CANCELLED
    if not _resolve(ghost_id, status, f"staff:{actor}", note):
        current = (get_ghost_container(ghost_id) or {}).get("status")
        raise HoldError(f"This hold has already ended: {str(current).lower()}.", code="resolved")
    if status == RELEASED:
        _debit_if_sandbox(container, container["user_id"])
    _settled(container, status, f"staff:{actor}", note)
    return get_ghost_container(ghost_id) or {}
