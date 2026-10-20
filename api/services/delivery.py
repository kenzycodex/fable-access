"""Getting a code or a message to a customer: email, SMS or in-app.

One place decides how a customer is reached, so every sender follows the same
rules:

  * A code goes to one registered, confirmed channel (email, or SMS where a
    provider is configured). It is delivered or it is a failed factor; it is
    never handed back to the caller.
  * A sandbox bank's customers are test customers with simulated money. Their
    codes and messages are also written to the sandbox inbox, which the demo
    app shows in a box labelled "Sandbox code", so testing never depends on
    anyone receiving a real email. A tester who registers a real address still
    gets real mail too. A live bank never gets an inbox entry, and the inbox
    endpoint refuses live banks.
  * SMS is for codes and short alerts; email carries longer notices.
"""
from __future__ import annotations

import logging

from core.db import cursor

logger = logging.getLogger("fable.delivery")

CHANNELS = ("email", "sms", "in_app")


def is_sandbox(institution_id: str | None) -> bool:
    from core.tenancy import institution_mode

    return institution_mode(institution_id) != "live"


def _institution_of(user_id: str) -> str | None:
    with cursor() as cur:
        cur.execute("SELECT institution_id FROM customers WHERE id = ?", (user_id,))
        row = cur.fetchone()
    return row["institution_id"] if row else None


def _inbox(user_id: str, institution_id: str | None, kind: str, channel: str, destination: str | None,
           subject: str, body: str, code: str | None = None, purpose: str | None = None,
           reference: str | None = None) -> None:
    try:
        with cursor() as cur:
            cur.execute(
                """INSERT INTO sandbox_inbox
                   (institution_id, user_id, kind, channel, destination, subject, body, code, purpose, reference)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                (institution_id, user_id, kind, channel, destination, subject, body, code, purpose, reference),
            )
    except Exception as exc:  # noqa: BLE001 - the inbox is a convenience for testers
        logger.warning("Could not write to the sandbox inbox: %s", type(exc).__name__)


def mask_email(email: str) -> str:
    name, _, domain = (email or "").partition("@")
    if not domain:
        return "your registered address"
    shown = name[:2] if len(name) > 2 else name[:1]
    return f"{shown}{'•' * max(len(name) - len(shown), 2)}@{domain}"


def mask_phone(phone: str) -> str:
    digits = "".join(c for c in (phone or "") if c.isdigit())
    if len(digits) < 4:
        return "your registered number"
    return f"{'•' * max(len(digits) - 4, 3)}{digits[-4:]}"


def sms_available(institution_id: str | None) -> bool:
    """Whether SMS codes can be used: a real provider, or the sandbox inbox."""
    from services import sms

    return sms.configured() or is_sandbox(institution_id)


def send_code(user_id: str, channel: str, destination: str, code: str, purpose: str,
              reference: str | None = None, institution_id: str | None = None) -> dict:
    """Deliver a one-time code. {"delivered", "channel", "destination", "sandbox"}."""
    from services import mailer, sms

    institution_id = institution_id or _institution_of(user_id)
    sandbox = is_sandbox(institution_id)
    if channel == "sms":
        text = f"Your verification code is {code}. Never share it, not even with your bank."
        real = sms.send(destination, text).sent if sms.configured() else False
        masked = mask_phone(destination)
    else:
        channel = "email"
        real = mailer.send(
            destination, f"Your verification code: {code}",
            f"Your verification code is {code}. It expires in 10 minutes.\n\n"
            "If you did not request this, someone may be trying to move money from your account. "
            "Do not share this code with anyone, including staff.",
        ) if destination else False
        masked = mask_email(destination)
    if sandbox:
        _inbox(user_id, institution_id, "code", channel, masked, "Verification code",
               f"Code for {purpose}", code=code, purpose=purpose, reference=reference)
    return {"delivered": bool(real or sandbox), "channel": channel, "destination": masked,
            "sandbox": sandbox, "real_delivery": bool(real)}


def notify(user_id: str, institution_id: str | None, title: str, body: str, *,
           email: str | None = None, sms_text: str | None = None, phone: str | None = None) -> dict:
    """Send a notice by email (and a short SMS where given and configured).
    A sandbox bank's notices are also written to its inbox. Returns what was
    actually delivered; the caller records it in the in-app feed."""
    from services import mailer, sms

    delivered = {"email": False, "sms": False}
    if email:
        delivered["email"] = mailer.send(email, title, body)
    if sms_text and phone and sms.configured():
        delivered["sms"] = sms.send(phone, sms_text).sent
    if is_sandbox(institution_id):
        _inbox(user_id, institution_id, "notice", "email" if email else "in_app",
               mask_email(email) if email else None, title, body)
    return delivered


def sandbox_inbox(user_id: str, institution_id: str, limit: int = 20) -> list[dict]:
    """The latest codes and notices for a sandbox customer (newest first)."""
    from core.db import row_to_dict

    with cursor() as cur:
        cur.execute(
            """SELECT id, kind, channel, destination, subject, body, code, purpose, reference, created_at
               FROM sandbox_inbox WHERE user_id = ? AND institution_id = ?
               ORDER BY id DESC LIMIT ?""",
            (user_id, institution_id, limit),
        )
        return [row_to_dict(r) for r in cur.fetchall()]
