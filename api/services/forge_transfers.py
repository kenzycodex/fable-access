"""Transfers Fable has decided on, and what happens to the money afterwards.

Fable decides (pass, flag or block). The bank moves the money. This module is
the join between the two, and it follows one rule above the rest: a transfer
reaches the bank at most once. `execute` claims the row with a single UPDATE
before it calls the bank, so two requests (a retried tap, a webhook racing a
poll) cannot both send. If the bank's answer is lost, the row is left in
`unknown` and only ever queried; see services/forge_bank.py.

States: decided | awaiting_stepup | held | sending | unknown | pending |
successful | failed | reversed.
"""
import logging
import time

from core.db import cursor, dumps, loads, row_to_dict
from services import forge_bank
from services.forge_bank import BankError, OutcomeUnknown

logger = logging.getLogger("fable.forge")

# A name enquiry reference expires after 10 minutes at the bank. Inside this
# many seconds it is reused; after that a fresh one is fetched.
REF_FRESH_SECONDS = 8 * 60
SENDABLE = ("decided", "awaiting_stepup", "held")
FINAL = ("successful", "failed", "reversed")
_BANK_STATES = {"successful": "successful", "success": "successful", "failed": "failed",
                "reversed": "reversed", "pending": "pending", "processing": "pending",
                "in_progress": "pending"}


def get(transfer_id: str) -> dict | None:
    with cursor() as cur:
        cur.execute("SELECT * FROM forge_transfers WHERE id = ?", (transfer_id,))
        return row_to_dict(cur.fetchone()) if cur else None


def by_reference(reference: str) -> dict | None:
    with cursor() as cur:
        cur.execute("SELECT * FROM forge_transfers WHERE reference = ?", (reference,))
        return row_to_dict(cur.fetchone())


def record(*, transfer_id: str, institution_id: str, user_id: str, source_account: str,
           destination_account: str, destination_bank_code: str | None, intra: bool,
           recipient_name: str | None, amount: float, narration: str, name_enquiry_ref: str | None,
           action: str, reference: str | None = None) -> dict:
    """Store a decided transfer. PASS is ready to send; FLAG waits for the
    customer to verify; BLOCK waits in Ghost's cooling window."""
    state = {"PASS": "decided", "FLAG": "awaiting_stepup", "BLOCK": "held"}[action]
    reference = reference or forge_bank.new_reference()
    with cursor() as cur:
        cur.execute(
            """INSERT INTO forge_transfers (id, institution_id, user_id, reference, source_account,
                   destination_account, destination_bank_code, intra, recipient_name, amount, narration,
                   name_enquiry_ref, name_enquiry_at, action, state)
               VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
            (transfer_id, institution_id, user_id, reference, source_account, destination_account,
             destination_bank_code, 1 if intra else 0, recipient_name, amount, narration,
             name_enquiry_ref, time.time() if name_enquiry_ref else None, action, state),
        )
    _set(transfer_id, state=state)  # starts the trail with where it began
    return get(transfer_id)


def _set(transfer_id: str, **fields) -> None:
    if "state" in fields:
        # Keep every state the transfer passed through, so "the answer was lost,
        # so we asked the bank" can be shown, not just where it ended up.
        row = get(transfer_id) or {}
        trail = loads(row.get("trail"), []) or []
        if not trail or trail[-1]["state"] != fields["state"]:
            trail.append({"state": fields["state"], "note": fields.get("last_error")})
            fields["trail"] = dumps(trail)
    sets = ", ".join(f"{k} = ?" for k in fields)
    with cursor() as cur:
        cur.execute(f"UPDATE forge_transfers SET {sets}, updated_at = datetime('now') WHERE id = ?",  # noqa: S608
                    (*fields.values(), transfer_id))


def _apply_bank_reply(transfer_id: str, data: dict) -> dict:
    state = _BANK_STATES.get(str(data.get("status", "")).lower(), "pending")
    row = get(transfer_id) or {}
    if state in FINAL and data.get("fee") is None and row.get("reference"):
        # The requery reply carries the status only; the transfer record has
        # the charges, so read them from there rather than show none.
        try:
            data = {**forge_bank.transfer_status(row["reference"]), **{"status": data.get("status")}}
        except Exception:  # noqa: BLE001 - the charges are shown later, never block the state
            logger.warning("Could not read the charges for %s", row["reference"])
    # A reply without charges never wipes the ones already recorded.
    charges = {k: data[k] for k in ("fee", "vat", "stamp_duty", "total_debit") if data.get(k) is not None}
    _set(transfer_id, state=state, last_error=None, **charges)
    _teach_baseline(transfer_id, state)
    return get(transfer_id)


def _teach_baseline(transfer_id: str, state: str) -> None:
    """What the bank did is the label Copilot learns from: a completed transfer
    is the customer's normal; a failed or reversed one is not."""
    if state not in FINAL:
        return
    try:
        with cursor() as cur:
            cur.execute(
                "UPDATE transactions SET status = ?, confirmed_legitimate = ? WHERE id = ?",
                ("completed" if state == "successful" else state, 1 if state == "successful" else 0, transfer_id),
            )
    except Exception as exc:  # noqa: BLE001 - learning must never undo a payment
        logger.warning("Could not record the outcome of %s: %s", transfer_id, type(exc).__name__)


def execute(transfer_id: str, *, poll_attempts: int = 3, poll_wait: float = 2.0) -> dict:
    """Send the transfer to the bank, once. Safe to call again: a transfer that
    is already on its way (or finished) is returned as it stands."""
    with cursor() as cur:
        cur.execute(
            f"UPDATE forge_transfers SET state = 'sending', updated_at = datetime('now') "  # noqa: S608
            f"WHERE id = ? AND state IN ({','.join('?' * len(SENDABLE))})",
            (transfer_id, *SENDABLE),
        )
        claimed = cur.rowcount == 1
    row = get(transfer_id)
    if row is None:
        raise KeyError(transfer_id)
    if not claimed:
        return refresh(transfer_id) if row["state"] in ("unknown", "pending") else row

    try:
        ref = row["name_enquiry_ref"]
        fresh = ref and row["name_enquiry_at"] and time.time() - row["name_enquiry_at"] < REF_FRESH_SECONDS
        if not fresh:
            # The customer saw this name when they started. If the account now
            # resolves to someone else, the transfer must not go.
            enquiry = forge_bank.name_enquiry(row["destination_account"], row["destination_bank_code"],
                                              intra=bool(row["intra"]))
            if row["recipient_name"] and enquiry.get("account_name", "").strip().casefold() != row["recipient_name"].strip().casefold():
                _set(transfer_id, state="failed", last_error="The account now resolves to a different name.")
                return get(transfer_id)
            ref = enquiry.get("name_enquiry_ref")
        sent = forge_bank.send_transfer(
            source_account=row["source_account"], destination_account=row["destination_account"],
            destination_bank_code=row["destination_bank_code"], intra=bool(row["intra"]),
            name_enquiry_ref=ref, amount=row["amount"], narration=row["narration"] or "",
            reference=row["reference"])
        out = _apply_bank_reply(transfer_id, sent)
    except OutcomeUnknown as exc:
        # Never resend. Mark it unknown and ask the bank what happened.
        _set(transfer_id, state="unknown", last_error=exc.reason)
        return refresh(transfer_id, attempts=poll_attempts, wait=poll_wait)
    except BankError as exc:
        _set(transfer_id, state="failed", last_error=f"{exc.code}: {exc.message}"[:300])
        return get(transfer_id)
    if out["state"] == "pending":
        return refresh(transfer_id, attempts=poll_attempts, wait=poll_wait)
    return out


def refresh(transfer_id: str, *, attempts: int = 1, wait: float = 0.0) -> dict:
    """Ask the bank where a sent transfer stands. Reads only; sends nothing."""
    row = get(transfer_id)
    if row is None or row["state"] in FINAL or row["state"] not in ("unknown", "pending", "sending"):
        return row
    try:
        data = forge_bank.settle(row["reference"], attempts=attempts, wait_seconds=wait,
                                 interbank=not row["intra"])
    except BankError as exc:
        _set(transfer_id, last_error=f"{exc.code}: {exc.message}"[:300])
        return get(transfer_id)
    if not data:
        return row
    return _apply_bank_reply(transfer_id, data)


def apply_event(event: str, data: dict) -> dict | None:
    """A bank webhook about a transfer. Returns the updated row, or None when
    the reference is not one of ours."""
    reference = data.get("reference") or data.get("transfer_reference")
    row = by_reference(reference) if reference else None
    if row is None:
        return None
    mapped = {"transfer.successful": "successful", "transfer.failed": "failed",
              "transfer.reversed": "reversed", "transfer.pending": "pending"}.get(event)
    if mapped is None:
        return row
    # A final state is never walked back to pending by a late or replayed event.
    if row["state"] in FINAL and mapped == "pending":
        return row
    charges = {k: data[k] for k in ("fee", "vat", "stamp_duty", "total_debit") if data.get(k) is not None}
    _set(row["id"], state=mapped, **charges)
    _teach_baseline(row["id"], mapped)
    return get(row["id"])
