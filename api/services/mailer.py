"""The one way Fable sends email.

There used to be six copies of the same SMTP block (password resets, team and
operator invites, customer alerts, verification codes, owner security alerts),
and two of them had no timeout, so a mail server that accepted the connection
and then went quiet could hold a request thread indefinitely. They also logged
failures differently, and one logged the recipient's address in full.

Every sender now goes through `send`. It never raises: a caller learns whether
the message was handed to the mail server and decides what that means for it
(a verification code that was not sent is a failed factor; an invite that was
not sent can be re-sent).
"""
import logging
import smtplib
from email.message import EmailMessage

from core import integrations

logger = logging.getLogger("fable.mailer")

# Seconds to wait for the mail server at each step. Long enough for a slow
# provider, short enough that a stuck one cannot pin a worker.
TIMEOUT_SECONDS = 10


def configured() -> bool:
    """Whether outgoing mail is set up at all."""
    s = integrations.smtp()
    return bool(s["username"] and s["password"])


def _redact(address: str) -> str:
    name, _, domain = (address or "").partition("@")
    return f"{name[:1]}***@{domain}" if domain else "***"


def send(to: str, subject: str, body: str, html: str | None = None,
         from_address: str | None = None) -> bool:
    """Send one message. True when the mail server accepted it."""
    if not configured() or not to:
        return False
    s = integrations.smtp()
    msg = EmailMessage()
    msg["Subject"] = subject
    msg["From"] = from_address or s["from"]
    msg["To"] = to
    msg.set_content(body)
    if html:
        msg.add_alternative(html, subtype="html")
    try:
        with smtplib.SMTP(s["server"], s["port"], timeout=TIMEOUT_SECONDS) as server:
            server.starttls()
            server.login(s["username"], s["password"])
            server.send_message(msg)
        return True
    except Exception as exc:  # noqa: BLE001 - the caller decides what a failed send means
        logger.warning("Email to %s failed: %s", _redact(to), type(exc).__name__)
        return False
