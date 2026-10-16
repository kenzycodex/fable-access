"""Out-of-band customer alerts.

Containment previously told nobody. A transfer entered a cooling window and the
only place that appeared was the screen the transfer was made from, which is
precisely the screen an attacker is holding in the scenario containment exists
to survive. The whole argument for a cooling window is that it gives the real
customer a chance to intervene, and they cannot intervene if the only notice
goes to the session that just tried to move their money.

Delivery is deliberately out-of-band: the customer's registered email or phone,
not the session. Same reasoning as `assurance.py` applies to a one-time code.

Everything here is best-effort and runs off the request path. A containment
hold must never fail, or be delayed, because an SMTP server is slow. A failed
send is recorded so the console can show that the customer was not reachable,
which is itself worth knowing.
"""
import logging

from core.db import cursor

logger = logging.getLogger("fable.notifications")


def record(user_id: str, institution_id: str | None, kind: str, title: str,
           body: str, reference: str | None = None, channel: str = "in_app",
           delivered: bool = False) -> None:
    """Persist a notification so the in-app feed and the console agree on what
    the customer was told, and whether it actually reached them."""
    try:
        with cursor() as cur:
            cur.execute(
                """INSERT INTO notifications
                   (user_id, institution_id, kind, title, body, reference, channel, delivered)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?)""",
                (user_id, institution_id, kind, title, body, reference, channel, 1 if delivered else 0),
            )
    except Exception as exc:  # noqa: BLE001 — never break the caller
        logger.warning("Could not record notification for %s: %s", user_id, exc)


def _send_email(to: str, subject: str, body: str) -> bool:
    from services import mailer

    return mailer.send(to, subject, body)


def notify_decision(user_id: str, institution_id: str | None, transaction_id: str,
                    action: str, amount: float, recipient: str | None,
                    explanation: str) -> None:
    """Record that a transfer was stopped or questioned.

    In-app only. A blocked transfer has already been prevented, so there is no
    urgency that justifies an email for every one; containment is different
    because the customer has a decision to make inside a time window.
    """
    if action == "BLOCK":
        title = "Transfer blocked"
        body = (
            f"NGN {amount:,.0f}" + (f" to {recipient}" if recipient else "")
            + f" was stopped. {explanation}"
        )
    elif action == "FLAG":
        title = "Transfer needed a check"
        body = (
            f"NGN {amount:,.0f}" + (f" to {recipient}" if recipient else "")
            + " looked unusual, so we asked you to confirm it first."
        )
    else:
        return

    record(user_id, institution_id, action.lower(), title, body,
           reference=transaction_id, channel="in_app", delivered=True)


def for_user(user_id: str, limit: int = 30) -> list[dict]:
    """This customer's notifications, newest first."""
    from core.db import row_to_dict

    with cursor() as cur:
        cur.execute(
            """SELECT id, kind, title, body, reference, channel, delivered, read_at, created_at
               FROM notifications WHERE user_id = ?
               ORDER BY id DESC LIMIT ?""",
            (user_id, limit),
        )
        return [row_to_dict(r) for r in cur.fetchall()]


def mark_read(user_id: str) -> int:
    with cursor() as cur:
        cur.execute(
            "UPDATE notifications SET read_at = datetime('now') "
            "WHERE user_id = ? AND read_at IS NULL",
            (user_id,),
        )
        return cur.rowcount


def notify_containment(user_id: str, institution_id: str | None, ghost_id: str,
                       amount: float, recipient: str | None, cooling_minutes: int,
                       explanation: str) -> None:
    """Tell the customer their money is being held, through a channel the
    session cannot read.

    Called off the request path. Safe to fail: the hold already exists and the
    money is already protected, so a delivery problem degrades the warning, not
    the containment.
    """
    from core import security

    title = "We're holding a transfer on your account"
    body = (
        f"Fable has paused a transfer of NGN {amount:,.0f}"
        + (f" to {recipient}" if recipient else "")
        + f" for {cooling_minutes} minutes.\n\n"
        f"{explanation}\n\n"
        "If this was you, open your bank app and confirm it.\n"
        "If it was NOT you, open the app and cancel it. The money has not left "
        "your account and cancelling returns it immediately.\n\n"
        "Nobody from your bank or from Fable will ever ask you for your PIN, "
        "your one-time code, or to move money to a 'safe account'."
    )

    contact = security.get_contact(user_id)
    destination = contact.get("email")
    delivered = False
    channel = "in_app"

    if destination:
        channel = "email"
        delivered = _send_email(destination, title, body)
    elif contact.get("phone"):
        # No SMS provider is wired (Termii/Twilio would slot in here), so this
        # is recorded as undelivered rather than pretended.
        channel = "sms"
        delivered = False

    record(user_id, institution_id, "containment", title, body,
           reference=ghost_id, channel=channel, delivered=delivered)

    if not delivered:
        logger.info(
            "Containment alert for %s (%s) was not delivered out-of-band; "
            "the customer will only see it in-app.", user_id, ghost_id,
        )


_SECURITY_COPY = {
    "pin_set": ("A transaction PIN was set", "A transaction PIN was set on your account."),
    "pin_changed": ("Your transaction PIN was changed", "Your transaction PIN was changed."),
    "pin_reset": ("Your transaction PIN was reset",
                  "Your bank reset your transaction PIN. You will choose a new one the next time you verify a transfer."),
    "email_changed": ("Your verification email was changed",
                      "The email address that receives your verification codes was changed."),
    "phone_changed": ("Your phone number was changed", "The phone number on your account was changed."),
    "passkey_added": ("A device was added", "A new device was added for fingerprint or face confirmation."),
    "two_factor_changed": ("Your verification preference changed",
                           "Your 'always ask me to verify' setting was changed."),
}


def notify_security_change(user_id: str, institution_id: str | None, change: str,
                           also_email: str | None = None) -> None:
    """Tell the customer a security setting changed, in-app and by email.

    `also_email` is the previous address when the email itself changed, so the
    person who owned the account before the change hears about it: a takeover
    that reroutes codes must not be silent to the real customer.
    """
    from core import security

    title, lead = _SECURITY_COPY.get(change, ("Your security settings changed", "A security setting was changed."))
    body = (
        f"{lead}\n\nIf this was you, there is nothing to do.\n"
        "If it was NOT you, contact your bank straight away and do not approve any transfer you did not start."
    )
    current = security.get_contact(user_id).get("email")
    delivered = False
    for address in {a for a in (current, also_email) if a}:
        delivered = _send_email(address, title, body) or delivered
    emailed = bool(current or also_email)
    record(user_id, institution_id, "security", title, body,
           channel="email" if emailed else "in_app", delivered=delivered if emailed else True)


def notify_hold_ended(user_id: str, institution_id: str | None, ghost_id: str, amount: float,
                      status: str, by: str) -> None:
    """Tell the customer how a hold ended, in-app and by email when they have one."""
    from core import security

    staff = by.startswith("staff:")
    copy = {
        "RELEASED": ("Your held transfer was sent",
                     f"The NGN {amount:,.0f} transfer we were holding has been released"
                     + (" by your bank after it confirmed with you." if staff else " after you verified it.")),
        "CANCELLED": ("Your held transfer was cancelled",
                      f"The NGN {amount:,.0f} transfer we were holding was cancelled"
                      + (" by your bank." if staff else ".") + " The money stayed in your account."),
        "EXPIRED": ("Your held transfer was not sent",
                    f"The NGN {amount:,.0f} transfer we were holding was not confirmed in time, so it was not "
                    "sent. The money stayed in your account."),
    }
    title, lead = copy.get(status, ("Your held transfer changed", "A held transfer changed."))
    body = lead + "\n\nIf you did not expect this, contact your bank straight away."
    email = security.get_contact(user_id).get("email")
    delivered = _send_email(email, title, body) if email else True
    record(user_id, institution_id, "containment", title, body, reference=ghost_id,
           channel="email" if email else "in_app", delivered=delivered)


def notify_release_requested(user_id: str, institution_id: str | None, ghost_id: str, amount: float,
                             hours: int) -> None:
    """Confirm to the customer that their bank has been asked to verify them."""
    from core import security

    title = "We've asked your bank to verify you"
    body = (
        f"You asked your bank to release the NGN {amount:,.0f} transfer we are holding. Someone from the bank "
        f"may contact you on the number they have on file. The money stays held for up to {hours} hours and "
        "is returned to you if nobody releases it.\n\n"
        "Nobody from your bank or from Fable will ever ask you for your PIN or a one-time code."
    )
    email = security.get_contact(user_id).get("email")
    delivered = _send_email(email, title, body) if email else True
    record(user_id, institution_id, "containment", title, body, reference=ghost_id,
           channel="email" if email else "in_app", delivered=delivered)
