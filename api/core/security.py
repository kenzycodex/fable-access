"""Customer-held security factors.

The transaction PIN is a real factor, not a prop: hashed with Argon2id over an
HMAC with a server-held pepper, never stored or logged in the clear,
rate-limited, and locked after repeated wrong attempts. The pepper does not
replace the attempt limit; the two guard different attacks (offline guessing
of stolen hashes, and online guessing through the API). Verifying one issues the same step-up token a passkey does, so it
plugs into the existing assurance tiers rather than sitting beside them.
"""
import hashlib
import hmac
from datetime import datetime, timedelta, timezone

from core import config
from core.db import cursor, row_to_dict
from core.secrets import setting

PBKDF2_ROUNDS = 200_000
# The PIN rules (length, wrong attempts before a lock, lock time, whether weak
# PINs are refused) are platform settings: the server environment, else what an
# operator approved in the console, else config.py's default. They are read when
# used, so an approved change applies without a restart.

class SecurityError(ValueError):
    """Rejected input, with a message meant for the customer."""


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _hash_pin(pin: str, salt: str) -> str:
    """The original PBKDF2 PIN hash. Verified for PINs set before Argon2id."""
    return hashlib.pbkdf2_hmac("sha256", pin.encode(), salt.encode(), PBKDF2_ROUNDS).hex()


def _peppered(pin: str, pepper: str) -> str:
    return hmac.new(pepper.encode(), pin.encode(), hashlib.sha256).hexdigest() if pepper else pin


def _hash_pin_v2(pin: str) -> str:
    """`a2$<pepper id>$<argon2id hash of HMAC(pepper, pin)>`."""
    from core.utils import hash_password

    return f"a2${config.PIN_PEPPER_ID}${hash_password(_peppered(pin, config.PIN_PEPPER))}"


def _pin_matches(stored: str, pin: str) -> tuple[bool, bool]:
    """(matches, should re-hash). Never raises."""
    from core.utils import needs_rehash, verify_password

    if stored.startswith("a2$"):
        try:
            _, pepper_id, encoded = stored.split("$", 2)
        except ValueError:
            return False, False
        pepper = config.PIN_PEPPERS.get(pepper_id)
        if pepper is None:
            # The pepper this PIN was hashed with is not configured. The PIN
            # cannot be checked at all; say so loudly rather than lock quietly.
            import logging

            logging.getLogger("fable.security").error(
                "A PIN uses pepper id %s, which is not configured (FABLE_PIN_PEPPER / _PREVIOUS).", pepper_id)
            return False, False
        ok = verify_password(_peppered(pin, pepper), encoded)
        return ok, ok and (pepper_id != config.PIN_PEPPER_ID or needs_rehash(encoded))
    if "$" in stored:
        salt, digest = stored.split("$", 1)
        # Constant-time: a timing difference would leak how much of the PIN matched.
        return hmac.compare_digest(_hash_pin(pin, salt), digest), True
    return False, False


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
        # How many digits the customer's PIN has. A PIN set before the length
        # was recorded (or under another configured length) still reports its
        # real size, so the entry boxes match what they typed when they set it.
        "pin_length": ((row or {}).get("pin_length") or setting("FABLE_PIN_LENGTH")) if (row and row.get("pin_hash")) else setting("FABLE_PIN_LENGTH"),
        "pin_policy": {"length": setting("FABLE_PIN_LENGTH"), "block_weak": setting("FABLE_PIN_BLOCK_WEAK")},
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
        "contact_email_set_at": (row or {}).get("contact_email_set_at"),
        # An address waiting for the customer to enter the code sent to it.
        "pending_email": _mask_email(row["pending_email"]) if row and row.get("pending_email") else None,
        # No SMS provider is connected, so codes go by email only. A phone
        # number can be stored, but nothing is sent to it.
        "sms_available": False,
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


def has_any_factor(user_id: str) -> bool:
    """Whether the customer has set up anything that proves it is them."""
    from agents.shield.stepup import has_passkey

    row = _record(user_id) or {}
    return bool(row.get("pin_hash") or row.get("contact_email") or has_passkey(user_id))


def require_existing_factor(user_id: str, current_pin: str | None = None,
                            stepup_token: str | None = None) -> str | None:
    """Guard a security-settings change with a factor the customer already has.

    Changing where codes are sent, enrolling a device or replacing the PIN is
    exactly what a session-riding attacker wants. So once any factor exists,
    the change must prove one: the PIN (checked with the same lockout as every
    other PIN entry), or a step-up token for purpose "security_change" from a
    passkey or a code sent to the registered email. Bootstrapping the very
    first factor is allowed, because there is nothing yet to prove; factors set
    up that way never release money that was already held.

    Returns which factor was proved, or None for a first factor.
    """
    if not has_any_factor(user_id):
        return None
    if stepup_token:
        from agents.shield import stepup

        info = stepup.token_info(stepup_token, user_id, "security_change")
        if info and stepup.consume_token(stepup_token):
            return info["level"]
        raise SecurityError("That verification has expired. Verify again to make this change.")
    row = _record(user_id) or {}
    if row.get("pin_hash"):
        if not current_pin:
            raise SecurityError("Enter your transaction PIN to change this.")
        if not check_pin(user_id, current_pin):  # counts failures / locks out
            raise SecurityError("Your PIN isn't right.")
        return "pin"
    raise SecurityError("Verify it's you with your device or an emailed code to change this.")


def require_pin_if_set(user_id: str, current_pin: str | None) -> None:
    """Kept for callers that only ever pass a PIN; see require_existing_factor."""
    require_existing_factor(user_id, current_pin)


def _validate_email(email: str) -> str:
    email = email.strip()
    if not _EMAIL_RE.match(email) or len(email) > 254:
        raise SecurityError("That doesn't look like a valid email address.")
    return email


def _validate_phone(phone: str) -> str:
    digits = "".join(c for c in phone if c.isdigit())
    # Nigerian numbers are 11 local digits (0803...) or 13 with the country
    # code (234803...); accept the common international range rather than
    # hard-coding one format.
    if not (10 <= len(digits) <= 15):
        raise SecurityError("That doesn't look like a valid phone number.")
    return phone.strip()


def set_contact(user_id: str, email: str | None, phone: str | None,
                institution_id: str | None = None, current_pin: str | None = None,
                stepup_token: str | None = None) -> dict:
    """Start changing where the customer's codes go.

    Gated by an existing factor, so an attacker holding the session cannot
    reroute codes. A new email does not take effect until the customer enters
    the code sent to it (confirm_contact), so nobody can register an address
    they do not receive mail at. A phone number is stored as given: no SMS
    provider is connected, so nothing is ever sent to it and it is never a
    factor.
    """
    email = (email or "").strip() or None
    phone = (phone or "").strip() or None
    if not email and not phone:
        raise SecurityError("Enter an email or phone number.")
    if email:
        email = _validate_email(email)
    if phone:
        phone = _validate_phone(phone)

    require_existing_factor(user_id, current_pin, stepup_token)
    previous = _record(user_id) or {}
    now = _now().isoformat()
    phone_changed = bool(phone and phone != previous.get("contact_phone"))
    email_changed = bool(email and email != previous.get("contact_email"))

    with cursor() as cur:
        cur.execute(
            """INSERT INTO user_security (user_id, institution_id) VALUES (?, ?)
               ON CONFLICT(user_id) DO NOTHING""",
            (user_id, institution_id),
        )
        if phone_changed:
            cur.execute(
                "UPDATE user_security SET contact_phone = ?, contact_phone_set_at = ?, "
                "updated_at = datetime('now') WHERE user_id = ?",
                (phone, now, user_id),
            )
        if email_changed:
            cur.execute(
                "UPDATE user_security SET pending_email = ?, updated_at = datetime('now') WHERE user_id = ?",
                (email, user_id),
            )

    if phone_changed:
        from services import notifications

        notifications.notify_security_change(user_id, institution_id, "phone_changed")

    if not email_changed:
        return status(user_id)

    from agents.shield import stepup

    try:
        sent = stepup.send_otp(user_id, "contact_verify", None, email=email)
    except stepup.OtpDeliveryFailed as exc:
        with cursor() as cur:
            cur.execute("UPDATE user_security SET pending_email = NULL WHERE user_id = ?", (user_id,))
        raise SecurityError("We couldn't send a code to that address. Check it and try again.") from exc
    verification = {"challenge_id": sent["challenge_id"], "destination": sent["destination"]}
    if "debug_code" in sent:
        verification["debug_code"] = sent["debug_code"]
    return {**status(user_id), "verification": verification}


def confirm_contact(user_id: str, challenge_id: str, code: str,
                    institution_id: str | None = None) -> dict:
    """Make a pending email the customer's verification address, once they
    have entered the code sent to it. The previous address is told."""
    from agents.shield import stepup

    row = _record(user_id) or {}
    pending = row.get("pending_email")
    if not pending:
        raise SecurityError("There is no email waiting to be confirmed.")
    try:
        result = stepup.verify_otp(user_id, challenge_id, code)
    except ValueError as exc:
        raise SecurityError(str(exc)) from exc
    if result.get("purpose") != "contact_verify":
        raise SecurityError("That code was not sent to confirm an email address.")

    previous = row.get("contact_email")
    with cursor() as cur:
        cur.execute(
            """UPDATE user_security SET contact_email = ?, contact_email_set_at = ?, pending_email = NULL,
                      updated_at = datetime('now') WHERE user_id = ? AND pending_email = ?""",
            (pending, _now().isoformat(), user_id, pending),
        )
    from services import notifications

    notifications.notify_security_change(user_id, institution_id, "email_changed",
                                         also_email=previous if previous != pending else None)
    return status(user_id)


def _is_weak(pin: str) -> bool:
    """Repeated digits (0000) or a plain run (1234, 4321)."""
    if len(set(pin)) == 1:
        return True
    steps = {int(b) - int(a) for a, b in zip(pin, pin[1:])}
    return steps in ({1}, {-1})


def _validate_pin(pin: str) -> None:
    if len(pin) != setting("FABLE_PIN_LENGTH"):
        raise SecurityError(f"Your PIN must be {setting("FABLE_PIN_LENGTH")} digits.")
    if setting("FABLE_PIN_BLOCK_WEAK") and _is_weak(pin):
        raise SecurityError("That PIN is too easy to guess. Choose another.")


def set_pin(user_id: str, pin: str, current_pin: str | None = None,
            institution_id: str | None = None, stepup_token: str | None = None) -> dict:
    pin = pin.strip()
    if not pin.isdigit():
        raise SecurityError("Your PIN must be digits only.")
    _validate_pin(pin)

    row = _record(user_id)

    # Replacing an existing PIN requires the old one. Without this, a session
    # an attacker already holds could simply overwrite the factor meant to
    # stop them. The old PIN is checked by check_pin, so wrong guesses here
    # count towards the same lock as everywhere else: this used to compare
    # hashes directly, which made it an unlimited PIN-guessing oracle.
    if row and row.get("pin_hash"):
        if not current_pin:
            raise SecurityError("Enter your current PIN to change it.")
        if not check_pin(user_id, current_pin):
            raise SecurityError("Your current PIN isn't right.")
    else:
        # No PIN yet (never set, or reset by the bank). If another factor
        # exists it must be proved, so a reset cannot be followed by an
        # attacker choosing the new PIN.
        require_existing_factor(user_id, None, stepup_token)

    _store_pin(user_id, pin, institution_id)
    return status(user_id)


def _store_pin(user_id: str, pin: str, institution_id: str | None) -> None:
    stored = _hash_pin_v2(pin)

    with cursor() as cur:
        cur.execute(
            """INSERT INTO user_security (user_id, institution_id, pin_hash, pin_set_at, pin_length, failed_attempts, locked_until)
               VALUES (?, ?, ?, ?, ?, 0, NULL)
               ON CONFLICT(user_id) DO UPDATE SET
                 pin_hash = excluded.pin_hash,
                 pin_set_at = excluded.pin_set_at,
                 pin_length = excluded.pin_length,
                 failed_attempts = 0,
                 locked_until = NULL,
                 updated_at = datetime('now')""",
            (user_id, institution_id, stored, _now().isoformat(), len(pin)),
        )


def clear_pin(user_id: str) -> dict:
    """Remove a customer's PIN so they can choose a new one.

    This is the institution's reset: a bank can do it for a customer who has
    forgotten theirs, the same as at a branch. It deletes the factor rather than
    replacing it, so the institution never learns or chooses a customer's PIN.
    The customer sets a new one the next time a verification asks for it.
    """
    with cursor() as cur:
        cur.execute(
            """UPDATE user_security
               SET pin_hash = NULL, pin_set_at = NULL, pin_length = NULL, failed_attempts = 0,
                   locked_until = NULL, updated_at = datetime('now')
               WHERE user_id = ?""",
            (user_id,),
        )
    return status(user_id)


def _verify_hash(row: dict, pin: str) -> bool:
    ok, rehash = _pin_matches(row.get("pin_hash") or "", pin)
    if ok and rehash:
        # An older hash (PBKDF2, an earlier pepper, weaker parameters) is
        # replaced while the correct PIN is in hand. Nobody has to reset.
        with cursor() as cur:
            cur.execute("UPDATE user_security SET pin_hash = ? WHERE user_id = ?", (_hash_pin_v2(pin), row["user_id"]))
    return ok


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
        (_now() + timedelta(minutes=setting("FABLE_PIN_LOCKOUT_MINUTES"))).isoformat()
        if attempts >= setting("FABLE_PIN_MAX_ATTEMPTS")
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
            f"Too many wrong attempts. Locked for {setting("FABLE_PIN_LOCKOUT_MINUTES")} minutes."
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
