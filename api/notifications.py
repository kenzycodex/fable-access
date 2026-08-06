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
import smtplib
from email.message import EmailMessage

import config
from db import cursor

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
    if not (config.SMTP_USERNAME and config.SMTP_PASSWORD):
        return False
    msg = EmailMessage()
    msg["Subject"] = subject
    msg["From"] = config.SMTP_FROM
    msg["To"] = to
    msg.set_content(body)
    try:
        with smtplib.SMTP(config.SMTP_SERVER, config.SMTP_PORT, timeout=10) as server:
            server.starttls()
            server.login(config.SMTP_USERNAME, config.SMTP_PASSWORD)
            server.send_message(msg)
        return True
    except Exception as exc:  # noqa: BLE001
        logger.warning("Notification email to %s failed: %s", to, exc)
        return False


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
    from db import row_to_dict

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
    import security

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
