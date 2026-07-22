"""Customer-held security factors.

The transaction PIN is a real factor, not a prop: hashed with PBKDF2, never
stored or logged in the clear, rate-limited, and locked after repeated wrong
attempts. Verifying one issues the same step-up token a passkey does, so it
plugs into the existing assurance tiers rather than sitting beside them.
"""
import hashlib
import hmac
import secrets
from datetime import datetime, timedelta, timezone

from db import cursor, row_to_dict

PBKDF2_ROUNDS = 200_000
MAX_PIN_ATTEMPTS = 5
LOCKOUT_MINUTES = 15

# Rejected outright. A PIN a scammer can guess over a phone call is not a
# factor, and these are the ones people reach for first.
WEAK_PINS = {
    "0000", "1111", "2222", "3333", "4444", "5555", "6666", "7777", "8888",
    "9999", "1234", "4321", "1122", "1212", "0123", "123456", "654321",
    "111111", "000000", "121212",
}


class SecurityError(ValueError):
    """Rejected input, with a message meant for the customer."""


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _hash_pin(pin: str, salt: str) -> str:
    return hashlib.pbkdf2_hmac("sha256", pin.encode(), salt.encode(), PBKDF2_ROUNDS).hex()


def _record(user_id: str) -> dict | None:
    with cursor() as cur:
        cur.execute("SELECT * FROM user_security WHERE user_id = ?", (user_id,))
        return row_to_dict(cur.fetchone())


def _locked_until(row: dict | None) -> datetime | None:
    if not row or not row.get("locked_until"):
        return None
    try:
        until = datetime.fromisoformat(row["locked_until"])
        return until if until > _now() else None
    except ValueError:
        return None


def status(user_id: str) -> dict:
    """What the customer's security screen shows. Never leaks the PIN itself."""
    from agents.shield.stepup import list_credentials

    row = _record(user_id)
    locked = _locked_until(row)
    passkeys = list_credentials(user_id)
    email = (row or {}).get("contact_email")
    phone = (row or {}).get("contact_phone")

    return {
        "user_id": user_id,
        "pin_set": bool(row and row.get("pin_hash")),
        "pin_set_at": (row or {}).get("pin_set_at"),
        "pin_locked": bool(locked),
        "pin_locked_until": locked.isoformat() if locked else None,
        "failed_attempts": (row or {}).get("failed_attempts") or 0,
        "two_factor_enabled": bool((row or {}).get("two_factor_enabled")),
        "passkeys": passkeys,
        "passkey_count": len(passkeys),
        # Masked for display; the raw values only leave the server as a code
        # destination, never back to the client.
        "contact_email": _mask_email(email) if email else None,
        "contact_phone": _mask_phone(phone) if phone else None,
        "email_set": bool(email),
        "phone_set": bool(phone),
    }


def get_contact(user_id: str) -> dict:
    """Raw registered channels, for the code sender only."""
    row = _record(user_id)
    return {
        "email": (row or {}).get("contact_email"),
        "phone": (row or {}).get("contact_phone"),
    }


def _mask_email(email: str) -> str:
    name, _, domain = email.partition("@")
    if not domain:
        return "•••"
    shown = name[:2] if len(name) > 2 else name[:1]
    return f"{shown}{'•' * max(len(name) - len(shown), 2)}@{domain}"


def _mask_phone(phone: str) -> str:
    digits = "".join(c for c in phone if c.isdigit())
    if len(digits) < 4:
        return "•••"
    return f"{'•' * (len(digits) - 4)}{digits[-4:]}"


_EMAIL_RE = __import__("re").compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")


def require_pin_if_set(user_id: str, current_pin: str | None) -> None:
    """Guard a security-settings change with an existing factor.

    Changing where codes are sent, or enrolling a new device, is exactly what a
    session-riding attacker wants — redirect the OTP, trust their own phone. So
    once a PIN exists, changing any security setting must prove it, the same
    rule that already protects a PIN change. Bootstrapping the very first factor
    is allowed, because there is nothing yet to prove."""
    row = _record(user_id)
    if not (row and row.get("pin_hash")):
        return  # no PIN yet — first-factor setup
    if not current_pin:
        raise SecurityError("Enter your transaction PIN to change this.")
    if not check_pin(user_id, current_pin):  # counts failures / locks out
        raise SecurityError("Your PIN isn't right.")


def set_contact(user_id: str, email: str | None, phone: str | None,
                institution_id: str | None = None, current_pin: str | None = None) -> dict:
    """Register the customer's own email and/or phone for verification codes.
    Gated by the PIN once one exists, so an attacker can't reroute codes."""
    require_pin_if_set(user_id, current_pin)
    email = (email or "").strip() or None
    phone = (phone or "").strip() or None

    if email and not _EMAIL_RE.match(email):
        raise SecurityError("That doesn't look like a valid email address.")
    if phone:
        digits = "".join(c for c in phone if c.isdigit())
        # Nigerian numbers are 11 local digits (0803…) or 13 with the country
        # code (234803…); accept the common international range rather than
        # hard-coding one format.
        if not (10 <= len(digits) <= 15):
            raise SecurityError("That doesn't look like a valid phone number.")
    if not email and not phone:
        raise SecurityError("Enter an email or phone number.")

    with cursor() as cur:
        cur.execute(
            """INSERT INTO user_security (user_id, institution_id, contact_email, contact_phone)
               VALUES (?, ?, ?, ?)
               ON CONFLICT(user_id) DO UPDATE SET
                 contact_email = COALESCE(excluded.contact_email, user_security.contact_email),
                 contact_phone = COALESCE(excluded.contact_phone, user_security.contact_phone),
                 updated_at = datetime('now')""",
            (user_id, institution_id, email, phone),
        )
    return status(user_id)


def set_pin(user_id: str, pin: str, current_pin: str | None = None,
            institution_id: str | None = None) -> dict:
    pin = pin.strip()
    if not pin.isdigit():
        raise SecurityError("Your PIN must be digits only.")
    if len(pin) not in (4, 6):
        raise SecurityError("Your PIN must be 4 or 6 digits.")
    if pin in WEAK_PINS:
        raise SecurityError("That PIN is too easy to guess. Choose another.")
    if len(set(pin)) == 1:
        raise SecurityError("That PIN is too easy to guess. Choose another.")

    row = _record(user_id)

    # Replacing an existing PIN requires the old one. Without this, a session
    # an attacker already holds could simply overwrite the factor meant to
    # stop them.
    if row and row.get("pin_hash"):
        if not current_pin:
            raise SecurityError("Enter your current PIN to change it.")
        if not _verify_hash(row, current_pin):
            raise SecurityError("Your current PIN isn't right.")

    salt = secrets.token_hex(16)
    stored = f"{salt}${_hash_pin(pin, salt)}"

    with cursor() as cur:
        cur.execute(
            """INSERT INTO user_security (user_id, institution_id, pin_hash, pin_set_at, failed_attempts, locked_until)
               VALUES (?, ?, ?, ?, 0, NULL)
               ON CONFLICT(user_id) DO UPDATE SET
                 pin_hash = excluded.pin_hash,
                 pin_set_at = excluded.pin_set_at,
                 failed_attempts = 0,
                 locked_until = NULL,
                 updated_at = datetime('now')""",
            (user_id, institution_id, stored, _now().isoformat()),
        )
    return status(user_id)


def _verify_hash(row: dict, pin: str) -> bool:
    stored = row.get("pin_hash") or ""
    if "$" not in stored:
        return False
    salt, digest = stored.split("$", 1)
    # Constant-time: a timing difference would leak how much of the PIN matched.
    return hmac.compare_digest(_hash_pin(pin, salt), digest)


def verify_pin(user_id: str) -> None:
    """Present for symmetry with the step-up flow; see check_pin."""
    raise NotImplementedError


def check_pin(user_id: str, pin: str) -> bool:
    """Verify a PIN, counting failures and locking out after too many.

    Raises SecurityError when the account is locked or has no PIN, so the
    caller can say something useful rather than just 'wrong'.
    """
    row = _record(user_id)
    if not row or not row.get("pin_hash"):
        raise SecurityError("No PIN is set on this account yet.")

    locked = _locked_until(row)
    if locked:
        minutes = max(int((locked - _now()).total_seconds() // 60) + 1, 1)
        raise SecurityError(f"Too many wrong attempts. Try again in {minutes} minute(s).")

    if _verify_hash(row, pin.strip()):
        with cursor() as cur:
            cur.execute(
                "UPDATE user_security SET failed_attempts = 0, locked_until = NULL WHERE user_id = ?",
                (user_id,),
            )
        return True

    attempts = (row.get("failed_attempts") or 0) + 1
    lock_until = (
        (_now() + timedelta(minutes=LOCKOUT_MINUTES)).isoformat()
        if attempts >= MAX_PIN_ATTEMPTS
        else None
    )
    with cursor() as cur:
        cur.execute(
            "UPDATE user_security SET failed_attempts = ?, locked_until = ? WHERE user_id = ?",
            (attempts, lock_until, user_id),
        )

    # Failed PIN attempts are evidence in their own right; Shield reads them.
    from agents.shield.stepup import record_failure

    record_failure(user_id, "pin", "wrong_pin")

    if lock_until:
        raise SecurityError(
            f"Too many wrong attempts. Locked for {LOCKOUT_MINUTES} minutes."
        )
    return False


def set_two_factor(user_id: str, enabled: bool) -> dict:
    with cursor() as cur:
        cur.execute(
            """INSERT INTO user_security (user_id, two_factor_enabled)
               VALUES (?, ?)
               ON CONFLICT(user_id) DO UPDATE SET
                 two_factor_enabled = excluded.two_factor_enabled,
                 updated_at = datetime('now')""",
            (user_id, 1 if enabled else 0),
        )
    return status(user_id)
