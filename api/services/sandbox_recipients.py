"""A sandbox customer's saved recipients, from their own past transfers.

The sandbox app used to show the same four contacts compiled into the
frontend. Now a test customer's "Saved" list is the people they have actually
sent money to, taken from their imported and scored history.

Account numbers never travel to the browser in full: the list carries the last
four digits and a signed recipient token. A transfer to a saved recipient sends
the token back, and the server resolves it to the account. The token is bound
to the one customer it was issued for, so it cannot be replayed for another
customer, and it expires.
"""
from __future__ import annotations

import base64
import hashlib
import hmac
import json
import time

from core import config
from core.db import cursor

TOKEN_TTL_SECONDS = 24 * 3600
LIMIT = 8


class RecipientTokenError(ValueError):
    pass


def _key() -> bytes:
    return hmac.new(config.SESSION_SECRET.encode(), b"fable:recipient-token:v1", hashlib.sha256).digest()


def _b64e(raw: bytes) -> str:
    return base64.urlsafe_b64encode(raw).decode().rstrip("=")


def _b64d(text: str) -> bytes:
    return base64.urlsafe_b64decode(text + "=" * (-len(text) % 4))


def issue_token(user_id: str, account: str, bank: str | None, name: str | None) -> str:
    body = _b64e(json.dumps({"u": user_id, "a": account, "b": bank, "n": name,
                             "exp": int(time.time()) + TOKEN_TTL_SECONDS}, separators=(",", ":")).encode())
    sig = _b64e(hmac.new(_key(), body.encode(), hashlib.sha256).digest())
    return f"rcp.{body}.{sig}"


def resolve_token(token: str, user_id: str) -> dict:
    """The recipient a token stands for, if it was issued to this customer and is current."""
    try:
        prefix, body, sig = token.split(".")
    except ValueError as exc:
        raise RecipientTokenError("That saved recipient isn't valid. Choose it again.") from exc
    expected = _b64e(hmac.new(_key(), body.encode(), hashlib.sha256).digest())
    if prefix != "rcp" or not hmac.compare_digest(sig, expected):
        raise RecipientTokenError("That saved recipient isn't valid. Choose it again.")
    data = json.loads(_b64d(body))
    if data.get("u") != user_id:
        raise RecipientTokenError("That saved recipient belongs to another customer.")
    if int(data.get("exp", 0)) < time.time():
        raise RecipientTokenError("That saved recipient has expired. Choose it again.")
    return {"account": data["a"], "bank": data.get("b"), "name": data.get("n")}


def apply_token(transaction: dict, customer_id: str) -> None:
    """Fill a transfer's recipient from its saved-recipient token, if it has one.

    Raises HTTPException 422 for a bad token, or when there is neither a token
    nor an account number.
    """
    from fastapi import HTTPException

    token = transaction.pop("recipient_token", None)
    if token:
        try:
            saved = resolve_token(token, customer_id)
        except RecipientTokenError as exc:
            raise HTTPException(status_code=422, detail=str(exc)) from exc
        transaction["recipient_account"] = saved["account"]
        transaction["recipient_bank"] = transaction.get("recipient_bank") or saved["bank"]
        transaction["recipient_name"] = transaction.get("recipient_name") or saved["name"]
    if not transaction.get("recipient_account"):
        raise HTTPException(status_code=422, detail="Give the recipient's account number.")


def mask(account: str) -> str:
    digits = "".join(ch for ch in str(account) if ch.isdigit())
    return f"••{digits[-4:]}" if len(digits) >= 4 else "••••"


def for_customer(user_id: str, institution_id: str) -> list[dict]:
    """Up to eight recipients this customer has sent to, most recent first."""
    # Only money that actually went: a transfer Shield blocked, or one the
    # customer cancelled, may have been to a scammer, who must never become a
    # saved recipient.
    with cursor() as cur:
        cur.execute(
            """SELECT recipient_account AS account, MAX(recipient_bank) AS bank, MAX(recipient_name) AS name,
                      COUNT(*) AS times, MAX(created_at) AS last_sent
               FROM (
                 SELECT recipient_account, recipient_bank, NULLIF(recipient_name, '') AS recipient_name, created_at
                   FROM transactions
                  WHERE user_id = ? AND institution_id = ?
                    AND (action_taken = 'PASS' OR COALESCE(status, '') IN ('completed', 'released'))
                 UNION ALL
                 SELECT recipient_account, recipient_bank, NULLIF(recipient_name, ''), created_at
                   FROM transaction_history
                  WHERE user_id = ? AND institution_id = ? AND outcome = 'completed'
               )
               WHERE recipient_account IS NOT NULL AND recipient_account != ''
               GROUP BY recipient_account ORDER BY last_sent DESC LIMIT ?""",
            (user_id, institution_id, user_id, institution_id, LIMIT),
        )
        rows = [dict(r) for r in cur.fetchall()]
    out = []
    for r in rows:
        name = r["name"]
        out.append({
            "token": issue_token(user_id, r["account"], r["bank"], name),
            "name": name or f"Account {mask(r['account'])}",
            "bank": r["bank"],
            "account_last4": mask(r["account"]),
            "times": r["times"],
            "last_sent": r["last_sent"],
        })
    return out
