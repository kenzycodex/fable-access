"""Balances that behave like money.

The balance is authoritative here, on the server, and every movement writes a
ledger entry. Previously the demo bank computed a balance on the client from
an opening figure that nothing debited and nothing checked, so a transfer could
exceed it freely — which quietly undermined every claim the product makes about
holding and returning funds.

Two numbers matter and they are not the same:

    balance    settled funds
    held       money inside an active Ghost container
    available  balance - held

Money in containment has left what the customer can spend but has *not* been
debited: it is still recoverable. Flattening those into one number would erase
the distinction the whole containment story rests on.
"""
from datetime import datetime, timezone

import config
from db import cursor, row_to_dict


class InsufficientFunds(Exception):
    """Raised before scoring, so a transfer that cannot execute never reaches
    Shield and never lands in Copilot's baseline as a fraud signal."""

    def __init__(self, available: float, requested: float):
        self.available = available
        self.requested = requested
        self.shortfall = round(requested - available, 2)
        super().__init__(
            f"Insufficient funds: ₦{requested:,.2f} requested, ₦{available:,.2f} available."
        )


class TopUpRejected(Exception):
    """A guard was hit. Carries which one, and when it resets."""

    def __init__(self, message: str, limit: str, resets_at: str | None = None):
        self.limit = limit
        self.resets_at = resets_at
        super().__init__(message)


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def ensure_account(user_id: str, institution_id: str | None, opening_balance: float = 0.0) -> dict:
    """Fetch an account, creating it at zero if absent.

    New customers genuinely start empty — they fund themselves through Add
    Money. Only the seeded archetypes carry an opening balance, because their
    baselines have to mean something.
    """
    with cursor() as cur:
        cur.execute("SELECT * FROM accounts WHERE user_id = ?", (user_id,))
        row = row_to_dict(cur.fetchone())
        if row:
            return row

        cur.execute(
            "INSERT INTO accounts (user_id, institution_id, balance) VALUES (?, ?, ?)",
            (user_id, institution_id, opening_balance),
        )
        if opening_balance:
            cur.execute(
                """INSERT INTO ledger_entries
                   (user_id, institution_id, kind, amount, balance_after, reference)
                   VALUES (?, ?, 'topup', ?, ?, ?)""",
                (user_id, institution_id, opening_balance, opening_balance, f"opening:{user_id}"),
            )
        cur.execute("SELECT * FROM accounts WHERE user_id = ?", (user_id,))
        return row_to_dict(cur.fetchone())


def held_amount(user_id: str) -> float:
    """Money inside active Ghost containers — reserved, not yet debited."""
    with cursor() as cur:
        cur.execute(
            "SELECT COALESCE(SUM(amount), 0) AS held FROM ghost_containers "
            "WHERE user_id = ? AND status = 'HELD'",
            (user_id,),
        )
        return float(cur.fetchone()["held"] or 0)


def get_balance(user_id: str, institution_id: str | None = None) -> dict:
    account = ensure_account(user_id, institution_id)
    held = held_amount(user_id)
    balance = float(account["balance"] or 0)
    return {
        "user_id": user_id,
        "balance": round(balance, 2),
        "held": round(held, 2),
        "available": round(balance - held, 2),
        "updated_at": account["updated_at"],
    }


def assert_can_spend(user_id: str, amount: float, institution_id: str | None = None) -> dict:
    """Raise InsufficientFunds unless the account can cover this transfer.

    Held money is excluded deliberately: a customer with ₦50,000 sitting in a
    cooling window cannot spend it, because it may yet be returned.
    """
    snapshot = get_balance(user_id, institution_id)
    if amount > snapshot["available"]:
        raise InsufficientFunds(snapshot["available"], amount)
    return snapshot


def _apply(user_id: str, institution_id: str | None, kind: str, delta: float,
           transaction_id: str | None, reference: str | None) -> dict:
    """Move money and record why. `reference` makes a retry a no-op rather than
    a second movement."""
    ensure_account(user_id, institution_id)

    with cursor() as cur:
        if reference:
            cur.execute("SELECT balance_after FROM ledger_entries WHERE reference = ?", (reference,))
            existing = cur.fetchone()
            if existing:
                # Already applied. Replaying a queued offline transfer, or a
                # retried request, must not move money twice.
                return get_balance(user_id, institution_id)

        cur.execute("SELECT balance FROM accounts WHERE user_id = ?", (user_id,))
        balance = float(cur.fetchone()["balance"] or 0)
        new_balance = round(balance + delta, 2)

        cur.execute(
            "UPDATE accounts SET balance = ?, updated_at = ? WHERE user_id = ?",
            (new_balance, _now(), user_id),
        )
        cur.execute(
            """INSERT INTO ledger_entries
               (user_id, institution_id, kind, amount, balance_after, transaction_id, reference)
               VALUES (?, ?, ?, ?, ?, ?, ?)""",
            (user_id, institution_id, kind, abs(delta), new_balance, transaction_id, reference),
        )

    return get_balance(user_id, institution_id)


def debit(user_id: str, amount: float, institution_id: str | None = None,
          transaction_id: str | None = None, reference: str | None = None) -> dict:
    """Money actually leaves. Called when a transfer settles."""
    return _apply(user_id, institution_id, "debit", -abs(amount), transaction_id, reference)


def credit(user_id: str, amount: float, institution_id: str | None = None,
           transaction_id: str | None = None, reference: str | None = None,
           kind: str = "topup") -> dict:
    return _apply(user_id, institution_id, kind, abs(amount), transaction_id, reference)


def reverse(user_id: str, amount: float, institution_id: str | None = None,
            transaction_id: str | None = None, reference: str | None = None) -> dict:
    """Return money that was debited — a cancelled release, or a reversal."""
    return _apply(user_id, institution_id, "reversal", abs(amount), transaction_id, reference)


def statement(user_id: str, limit: int = 50) -> list[dict]:
    with cursor() as cur:
        cur.execute(
            """SELECT kind, amount, balance_after, transaction_id, created_at
               FROM ledger_entries WHERE user_id = ?
               ORDER BY id DESC LIMIT ?""",
            (user_id, limit),
        )
        return [row_to_dict(r) for r in cur.fetchall()]


# ---------------------------------------------------------------------------
# Top-up guards
# ---------------------------------------------------------------------------

def _today_totals(user_id: str) -> tuple[float, int]:
    with cursor() as cur:
        cur.execute(
            """SELECT COALESCE(SUM(amount), 0) AS total, COUNT(*) AS n
               FROM ledger_entries
               WHERE user_id = ? AND kind = 'topup'
                 AND created_at >= datetime('now', 'start of day')""",
            (user_id,),
        )
        row = cur.fetchone()
        return float(row["total"] or 0), int(row["n"] or 0)


def top_up(user_id: str, amount: float, institution_id: str | None = None,
           method: str = "card", reference: str | None = None) -> dict:
    """Add funds, subject to guards.

    This writes to the same database the institution's fraud metrics are
    computed from, so an unbounded top-up would let anyone distort them. Every
    rejection names the limit it hit rather than failing generically.
    """
    if amount <= 0:
        raise TopUpRejected("Enter an amount greater than zero.", "invalid")

    if amount > config.TOPUP_MAX_AMOUNT:
        raise TopUpRejected(
            f"Single top-up limit is ₦{config.TOPUP_MAX_AMOUNT:,.0f}.",
            "per_transaction",
        )

    today_total, today_count = _today_totals(user_id)

    if today_count >= config.TOPUP_DAILY_COUNT:
        raise TopUpRejected(
            f"You've reached {config.TOPUP_DAILY_COUNT} top-ups today. Resets at midnight.",
            "daily_count",
            resets_at="midnight",
        )

    if today_total + amount > config.TOPUP_DAILY_MAX:
        remaining = max(config.TOPUP_DAILY_MAX - today_total, 0)
        raise TopUpRejected(
            f"Daily top-up limit is ₦{config.TOPUP_DAILY_MAX:,.0f}. "
            f"You have ₦{remaining:,.0f} left today.",
            "daily_total",
            resets_at="midnight",
        )

    snapshot = credit(user_id, amount, institution_id, reference=reference, kind="topup")
    return {
        **snapshot,
        "credited": round(amount, 2),
        "method": method,
        "remaining_today": round(max(config.TOPUP_DAILY_MAX - (today_total + amount), 0), 2),
        "top_ups_left_today": max(config.TOPUP_DAILY_COUNT - (today_count + 1), 0),
    }


def limits() -> dict:
    """What the client should show before a top-up is attempted."""
    return {
        "max_amount": config.TOPUP_MAX_AMOUNT,
        "daily_max": config.TOPUP_DAILY_MAX,
        "daily_count": config.TOPUP_DAILY_COUNT,
    }
