"""The bank bridge: the sandbox demo, connected to the Xtradot Bank sandbox.

The sandbox app (the demo bank customers use) works on Fable's own simulated
ledger. For one institution, named in FORGE_BRIDGE_INSTITUTION, every transfer
that money actually moves on (a pass, a verified flag, a released hold) is also
sent to the Xtradot Bank sandbox, from the customer's own account there. The
app is unchanged; the bank's answer (reference, fee, VAT, stamp duty, status)
is then read from /v1/forge/transfers/{transaction id}.

Sending happens off the request path, once per transfer, through the same
claim-then-send state machine as the rest of the Forge integration
(services/forge_transfers.py): a lost answer is only ever queried, never resent.
"""
import logging
import os
from concurrent.futures import ThreadPoolExecutor

from core.db import cursor, row_to_dict
from services import forge_transfers

logger = logging.getLogger("fable.forge")

XTRADOT_NIP = "000014"

# The sandbox's banks (platform guide, section 5.4): name -> NIP code.
BANKS = {
    "Xtradot Bank": "000014",
    "GTBank": "000013",
    "Zenith Bank": "000015",
    "First Bank of Nigeria": "000016",
    "UBA": "000004",
    "Wema Bank": "000017",
    "OPay": "100004",
    "Moniepoint MFB": "090405",
    "Kuda MFB": "090267",
    "PalmPay": "100033",
}

# The team's own accounts at Xtradot Bank. The demo's customers use the account
# number as their reference, so a customer maps straight to their account.
TEAM_ACCOUNTS = {
    "0123456789": ("Adaeze Chiamaka Okonkwo", 1_500_000),
    "0123456790": ("Babatunde Olumide Adeyemi", 5_000_000),
    "0123456791": ("Musa Ibrahim Abdullahi", 250_000),
    "0123456792": ("Efosa Godwin Osagie", 40_000),
    "0123456793": ("Mama Nkechi Provisions Ltd", 12_000_000),
}

# The sandbox's beneficiaries: account -> (holder, bank name).
BENEFICIARIES = {
    "0987654321": ("Ngozi Adaobi Eze", "Xtradot Bank"),
    "0987654322": ("Aisha Hauwa Bello", "Xtradot Bank"),
    "0987654399": ("Obinna Kelechi Okafor", "Xtradot Bank"),
    "0123987001": ("Chukwuemeka Ifeanyi Nwosu", "GTBank"),
    "0123987099": ("Garba Sani Danjuma", "GTBank"),
    "0123987002": ("Funmilayo Abiola Ogunleye", "Zenith Bank"),
    "0123987003": ("Zainab Halima Yusuf", "First Bank of Nigeria"),
    "0123987004": ("Tamunotonye Briggs", "UBA"),
    "0123987098": ("Blessing Oghenekaro Edeh", "Wema Bank"),
    "8031234506": ("Ifeoluwa Grace Adebayo", "OPay"),
    "8051234507": ("Iya Bisi Foods Enterprises", "Moniepoint MFB"),
}

_pool = ThreadPoolExecutor(max_workers=2, thread_name_prefix="fable-bridge")


def institution() -> str:
    return os.getenv("FORGE_BRIDGE_INSTITUTION", "").strip()


def enabled_for(institution_id: str | None) -> bool:
    target = institution()
    return bool(target) and institution_id == target


def bank_code(account: str | None, bank: str | None, code: str | None = None) -> str | None:
    """The NIP code for a recipient: as sent, else from the bank's name, else
    from the sandbox's own beneficiary list."""
    if code and code in BANKS.values():
        return code
    if bank and bank in BANKS:
        return BANKS[bank]
    if account in BENEFICIARIES:
        return BANKS[BENEFICIARIES[account][1]]
    if account in TEAM_ACCOUNTS:
        return XTRADOT_NIP
    return None


def _source_account(user_id: str) -> str | None:
    with cursor() as cur:
        cur.execute("SELECT external_ref FROM customers WHERE id = ?", (user_id,))
        row = cur.fetchone()
    ref = row["external_ref"] if row else None
    return ref if ref in TEAM_ACCOUNTS else None


def mirror(transaction_id: str, *, recipient_bank_code: str | None = None) -> dict | None:
    """Send one decided, money-moving transfer to the bank, once. Returns the
    transfer's row, or None when this institution is not bridged."""
    with cursor() as cur:
        cur.execute("""SELECT id, user_id, institution_id, amount, recipient_account, recipient_bank,
                              recipient_name, narration, action_taken FROM transactions WHERE id = ?""",
                    (transaction_id,))
        txn = row_to_dict(cur.fetchone())
    if not txn or not enabled_for(txn["institution_id"]):
        return None
    existing = forge_transfers.get(transaction_id)
    if existing:
        return existing

    source = _source_account(txn["user_id"])
    code = bank_code(txn["recipient_account"], txn["recipient_bank"], recipient_bank_code)
    row = forge_transfers.record(
        transfer_id=transaction_id, institution_id=txn["institution_id"], user_id=txn["user_id"],
        source_account=source or "unknown", destination_account=txn["recipient_account"] or "unknown",
        destination_bank_code=code, intra=code == XTRADOT_NIP, recipient_name=txn["recipient_name"],
        amount=float(txn["amount"]), narration=(txn["narration"] or "Fable sandbox")[:100],
        name_enquiry_ref=None, action="PASS")
    if not source or not code or not txn["recipient_account"]:
        reason = ("This customer has no account at Xtradot Bank." if not source
                  else "The recipient's bank is not one of the sandbox's banks.")
        forge_transfers._set(transaction_id, state="failed", last_error=reason)  # noqa: SLF001
        return forge_transfers.get(transaction_id)
    return forge_transfers.execute(row["id"], poll_attempts=6, poll_wait=2.0)


def mirror_later(transaction_id: str, *, recipient_bank_code: str | None = None) -> None:
    """Queue the send off the request path. The decision has already been
    returned; the bank's answer is read later by the app."""
    try:
        with cursor() as cur:
            cur.execute("SELECT institution_id FROM transactions WHERE id = ?", (transaction_id,))
            row = cur.fetchone()
        if not row or not enabled_for(row["institution_id"]):
            return
    except Exception:  # noqa: BLE001 - the bridge must never affect a decision
        return

    def run():
        try:
            mirror(transaction_id, recipient_bank_code=recipient_bank_code)
        except Exception as exc:  # noqa: BLE001
            logger.warning("Sending %s to the bank failed: %s", transaction_id, type(exc).__name__)

    _pool.submit(run)
