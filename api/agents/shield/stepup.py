"""Step-up verification: passkeys and out-of-band codes.

Signatures are verified properly with py_webauthn — no shortcuts. A passkey's
private key lives in the authenticator's secure element and never reaches this
server, which is exactly the property that makes it useful here: an attacker
holding the session does not hold the key.

Everything issued is single-use, short-lived and bound to a purpose and a
reference, so a token minted to confirm a ₦5,000 transfer cannot be replayed
to release a ₦500,000 Ghost container.
"""
import base64
import hashlib
import hmac
import json
import secrets
from datetime import datetime, timedelta, timezone

import webauthn
from webauthn.helpers import base64url_to_bytes
from webauthn.helpers.structs import (
    AuthenticatorSelectionCriteria,
    PublicKeyCredentialDescriptor,
    ResidentKeyRequirement,
    UserVerificationRequirement,
)

from core import config
from core.db import cursor, row_to_dict
from services import audit

CHALLENGE_TTL_SECONDS = 300      # 5 minutes to complete a factor
TOKEN_TTL_SECONDS = config.STEPUP_TOKEN_TTL_SECONDS
OTP_TTL_SECONDS = config.OTP_TTL_SECONDS
MAX_OTP_ATTEMPTS = config.OTP_MAX_ATTEMPTS

# Relying Party identity. Must match the origin the browser is on; overridable
# so a deployed instance can set its real domain.
RP_ID = config.WEBAUTHN_RP_ID
RP_NAME = "Fable"
EXPECTED_ORIGINS = config.WEBAUTHN_ORIGINS


class OtpDeliveryFailed(RuntimeError):
    """The code could not be delivered, so the factor was not issued.

    Raised rather than degrading: a factor the customer never received must not
    be treated as satisfied, and must not be handed back to the caller.
    """


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _expiry(seconds: int) -> str:
    return (_now() + timedelta(seconds=seconds)).isoformat()


def _expired(iso: str) -> bool:
    try:
        return datetime.fromisoformat(iso) < _now()
    except ValueError:
        return True


def _b64(data: bytes) -> str:
    return base64.b64encode(data).decode()


def _unb64(data: str) -> bytes:
    return base64.b64decode(data)


# ---------------------------------------------------------------------------
# Challenge + token plumbing
# ---------------------------------------------------------------------------

def _store_challenge(user_id: str, kind: str, payload: str, purpose: str | None, reference: str | None, ttl: int) -> str:
    challenge_id = f"chl_{secrets.token_hex(12)}"
    with cursor() as cur:
        cur.execute(
            """INSERT INTO stepup_challenges
               (challenge_id, user_id, kind, payload, purpose, reference, expires_at)
               VALUES (?, ?, ?, ?, ?, ?, ?)""",
            (challenge_id, user_id, kind, payload, purpose, reference, _expiry(ttl)),
        )
    return challenge_id


def _take_challenge(challenge_id: str, user_id: str, kind: str) -> dict | None:
    """Fetch a live challenge. Returns None if missing, mismatched, consumed
    or expired — all of which must fail closed."""
    with cursor() as cur:
        cur.execute("SELECT * FROM stepup_challenges WHERE challenge_id = ?", (challenge_id,))
        row = row_to_dict(cur.fetchone())
    if not row:
        return None
    if row["user_id"] != user_id or row["kind"] != kind:
        return None
    if row["consumed"] or _expired(row["expires_at"]):
        return None
    return row


def _consume_challenge(challenge_id: str) -> None:
    with cursor() as cur:
        cur.execute("UPDATE stepup_challenges SET consumed = 1 WHERE challenge_id = ?", (challenge_id,))


SUCCESS_MARKER = "_verified_ok_"


def record_failure(user_id: str, kind: str, reason: str) -> None:
    with cursor() as cur:
        cur.execute(
            "INSERT INTO stepup_failures (user_id, kind, reason) VALUES (?, ?, ?)",
            (user_id, kind, reason),
        )
    audit.record(audit.STEPUP_FAILED, user_id, factor=kind, reason=reason)


def record_success(user_id: str) -> None:
    """Mark a successful verification, which draws a line under prior fumbles.

    A customer who has just proved who they are should not keep being treated
    as if they're failing verification — that is the opposite of learning. The
    marker lets recent_failure_count ignore anything before it, so a genuine
    success clears the signal without deleting the audit trail."""
    with cursor() as cur:
        cur.execute(
            "INSERT INTO stepup_failures (user_id, kind, reason) VALUES (?, ?, 'success')",
            (user_id, SUCCESS_MARKER),
        )


def recent_failure_count(user_id: str, within_minutes: int = 60) -> int:
    """Failed factor attempts in the window, fed back to Shield as evidence —
    but only those *since the last successful verification*. Once the customer
    proves it's them, earlier fumbles stop counting against the next transfer.

    The cutoff is computed by SQLite rather than Python on purpose. created_at
    defaults to datetime('now'), which writes "2026-07-19 13:00:00", while
    Python's isoformat() produces "2026-07-19T13:00:00+00:00". These are
    compared as strings, and ' ' sorts before 'T', so a Python-built cutoff
    made every row look older, silently disabling the signal.
    """
    with cursor() as cur:
        # The last success by row id (monotonic, so same-second ties resolve
        # correctly, unlike a second-precision timestamp).
        cur.execute(
            "SELECT MAX(id) AS i FROM stepup_failures WHERE user_id = ? AND kind = ?",
            (user_id, SUCCESS_MARKER),
        )
        last_ok_id = cur.fetchone()["i"]

        query = (
            "SELECT COUNT(*) AS n FROM stepup_failures "
            "WHERE user_id = ? AND kind != ? AND created_at >= datetime('now', ?)"
        )
        params: list = [user_id, SUCCESS_MARKER, f"-{int(within_minutes)} minutes"]
        if last_ok_id is not None:
            query += " AND id > ?"
            params.append(last_ok_id)
        cur.execute(query, params)
        return cur.fetchone()["n"]


def _token_key(token: str) -> str:
    """How a token is stored: a SHA-256 of it, never the token itself.

    Tokens used to be stored as issued, so anyone who could read the database
    (or a backup of it) could lift a live token and release a hold with it.
    The token is 192 random bits, so an unsalted hash is enough: there is
    nothing to guess, and a lookup by hash is a lookup by index, which leaks no
    timing about the value either.
    """
    return "h:" + hashlib.sha256(token.encode()).hexdigest()


def issue_token(user_id: str, level: str, purpose: str | None, reference: str | None,
                factors: dict | None = None, institution_id: str | None = None) -> dict:
    """Mint a single-use proof that `factors` were just verified.

    `factors` maps each factor that was proved ("pin", "passkey", "otp") to
    when that factor was enrolled (None when the record predates the
    timestamp). A release checks it, so a factor set up after money was
    contained proves nothing about who the customer is.
    """
    token = f"su_{secrets.token_urlsafe(24)}"
    with cursor() as cur:
        cur.execute(
            """INSERT INTO stepup_tokens
               (token, user_id, level, purpose, reference, expires_at, factors, institution_id)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?)""",
            (_token_key(token), user_id, level, purpose, reference, _expiry(TOKEN_TTL_SECONDS),
             json.dumps(factors or {}), institution_id or _institution_of(user_id)),
        )
    # Issuing a token means a factor was just satisfied — record the success so
    # the failed-verification signal resets for the next transfer.
    record_success(user_id)
    audit.record(audit.STEPUP_PASSED, user_id, level=level, purpose=purpose,
                 factors=sorted((factors or {}).keys()))
    return {"token": token, "level": level, "expires_in": TOKEN_TTL_SECONDS}


def _institution_of(user_id: str) -> str | None:
    with cursor() as cur:
        cur.execute("SELECT institution_id FROM customers WHERE id = ?", (user_id,))
        row = cur.fetchone()
    return row["institution_id"] if row else None


def token_info(token: str | None, user_id: str, purpose: str | None = None,
               reference: str | None = None) -> dict | None:
    """The live token's level and factors, or None if it proves nothing.

    Binding is checked, not just existence: a token for another customer,
    another purpose or another reference is worthless here. A token minted
    without a reference used to match every reference, so a PIN proved for one
    transfer could approve a different one; when the caller names a purpose or
    reference, the token must carry exactly that one.
    """
    if not token:
        return None
    with cursor() as cur:
        cur.execute("SELECT * FROM stepup_tokens WHERE token = ?", (_token_key(token),))
        row = row_to_dict(cur.fetchone())
    if not row:
        return None
    if row["user_id"] != user_id or row["consumed"] or _expired(row["expires_at"]):
        return None
    if purpose and row["purpose"] != purpose:
        return None
    if reference and row["reference"] != reference:
        return None
    try:
        factors = json.loads(row.get("factors") or "{}")
    except (TypeError, ValueError):
        factors = {}
    return {"level": row["level"], "factors": factors if isinstance(factors, dict) else {},
            "purpose": row["purpose"], "reference": row["reference"]}


def verify_token(token: str | None, user_id: str, purpose: str | None = None, reference: str | None = None) -> str | None:
    """The assurance level a token proves, or None if it proves nothing."""
    info = token_info(token, user_id, purpose, reference)
    return info["level"] if info else None


def consume_token(token: str) -> bool:
    """Spend a token. True only for the call that spent it, so two requests
    racing with the same token cannot both succeed."""
    if not token:
        return False
    with cursor() as cur:
        cur.execute("UPDATE stepup_tokens SET consumed = 1 WHERE token = ? AND consumed = 0",
                    (_token_key(token),))
        return cur.rowcount > 0


# ---------------------------------------------------------------------------
# When each factor was put in place
# ---------------------------------------------------------------------------

def _parse_time(value) -> datetime | None:
    if not value:
        return None
    try:
        when = datetime.fromisoformat(str(value).replace(" ", "T"))
    except (TypeError, ValueError):
        return None
    return when if when.tzinfo else when.replace(tzinfo=timezone.utc)


def factor_enrolled_at(user_id: str, factor: str, credential_id: str | None = None) -> str | None:
    """When a factor was set up, as an ISO string, or None if not recorded.

    None is treated as long-standing: the timestamp columns arrived after the
    factors did, and refusing every older factor would lock customers out for
    a schema change rather than a security event.
    """
    with cursor() as cur:
        if factor == "passkey":
            if credential_id:
                cur.execute("SELECT created_at FROM user_credentials WHERE credential_id = ? AND user_id = ?",
                            (credential_id, user_id))
            else:
                cur.execute("SELECT MIN(created_at) AS created_at FROM user_credentials WHERE user_id = ?",
                            (user_id,))
            row = cur.fetchone()
            return row["created_at"] if row else None
        cur.execute("SELECT pin_set_at, contact_email_set_at FROM user_security WHERE user_id = ?", (user_id,))
        row = cur.fetchone()
    if not row:
        return None
    return row["pin_set_at"] if factor == "pin" else row["contact_email_set_at"] if factor == "otp" else None


def contact_settle_window(user_id: str | None = None) -> timedelta:
    """How long a newly added or changed contact must exist before a code sent
    to it can release held money. A session-riding attacker's first move is to
    point codes at an address they control.

    A sandbox bank's customers hold simulated money, and its test customers are
    usually set up minutes before they are used, so the sandbox has its own,
    shorter window (default none). The rule that a factor set up after the hold
    never counts applies everywhere.
    """
    from core.secrets import setting

    if user_id:
        from core.tenancy import institution_mode

        if institution_mode(_institution_of(user_id)) != "live":
            try:
                return timedelta(minutes=int(setting("FABLE_SANDBOX_CONTACT_SETTLE_MINUTES")))
            except Exception:  # noqa: BLE001 - a missing setting falls back to the default
                return timedelta(minutes=config.SANDBOX_CONTACT_SETTLE_MINUTES)
    try:
        return timedelta(hours=int(setting("FABLE_CONTACT_SETTLE_HOURS")))
    except Exception:  # noqa: BLE001
        return timedelta(hours=config.CONTACT_SETTLE_HOURS)


def factors_predate(factors: dict, cutoff: datetime | None,
                    user_id: str | None = None) -> tuple[bool, list[str]]:
    """Whether every proved factor was in place before `cutoff`.

    A one-time code also has to go to a contact that has settled: one added or
    changed within the settle window counts as new, whenever the hold began.
    With no cutoff (nothing is held) only the settle rule applies.
    Returns (ok, the factors that do not count).
    """
    late = []
    settle = _now() - contact_settle_window(user_id)
    for name, enrolled in (factors or {}).items():
        when = _parse_time(enrolled)
        if when is None:
            continue
        if name == "otp":
            limit = settle if cutoff is None else min(cutoff, settle)
        elif cutoff is None:
            continue
        else:
            limit = cutoff
        if when >= limit:
            late.append(name)
    return not late, late


# ---------------------------------------------------------------------------
# WebAuthn — registration
# ---------------------------------------------------------------------------

def has_passkey(user_id: str, before: datetime | None = None) -> bool:
    """Whether the customer has a passkey.

    `before` restricts the answer to credentials enrolled prior to that moment,
    which is how a containment release ignores a passkey the caller enrolled
    after the money was already held. Without a cutoff, every credential counts.
    """
    with cursor() as cur:
        if before is None:
            cur.execute("SELECT 1 FROM user_credentials WHERE user_id = ? LIMIT 1", (user_id,))
        else:
            cur.execute(
                "SELECT 1 FROM user_credentials WHERE user_id = ? "
                "AND datetime(created_at) < datetime(?) LIMIT 1",
                (user_id, before.isoformat()),
            )
        return cur.fetchone() is not None


def list_credentials(user_id: str) -> list[dict]:
    with cursor() as cur:
        cur.execute(
            """SELECT credential_id, device_label, created_at, last_used_at
               FROM user_credentials WHERE user_id = ? ORDER BY created_at DESC""",
            (user_id,),
        )
        return [row_to_dict(r) for r in cur.fetchall()]


def begin_registration(user_id: str, display_name: str, institution_id: str | None) -> dict:
    existing = [
        PublicKeyCredentialDescriptor(id=base64url_to_bytes(c["credential_id"]))
        for c in list_credentials(user_id)
    ]
    options = webauthn.generate_registration_options(
        rp_id=RP_ID,
        rp_name=RP_NAME,
        user_id=user_id.encode(),
        user_name=display_name,
        user_display_name=display_name,
        exclude_credentials=existing,
        authenticator_selection=AuthenticatorSelectionCriteria(
            # Platform authenticator + resident key = the phone's own
            # fingerprint/face, which is the device-bound property we want.
            resident_key=ResidentKeyRequirement.PREFERRED,
            # Required, not preferred: a passkey that only proves the device is
            # present (no fingerprint, face or device PIN) is possession of the
            # phone, which is exactly what a thief has.
            user_verification=UserVerificationRequirement.REQUIRED,
        ),
    )
    challenge_id = _store_challenge(
        user_id, "webauthn_register", _b64(options.challenge), "enrolment", institution_id, CHALLENGE_TTL_SECONDS
    )
    return {
        "challenge_id": challenge_id,
        "options": json.loads(webauthn.options_to_json(options)),
    }


def complete_registration(user_id: str, challenge_id: str, credential: dict, device_label: str | None,
                          institution_id: str | None, device_fingerprint: str | None = None) -> dict:
    stored = _take_challenge(challenge_id, user_id, "webauthn_register")
    if not stored:
        record_failure(user_id, "webauthn_register", "challenge_invalid")
        raise ValueError("Registration challenge expired or already used.")

    try:
        verified = webauthn.verify_registration_response(
            credential=credential,
            expected_challenge=_unb64(stored["payload"]),
            expected_rp_id=RP_ID,
            expected_origin=EXPECTED_ORIGINS,
            require_user_verification=True,
        )
    except Exception as exc:
        record_failure(user_id, "webauthn_register", type(exc).__name__)
        raise ValueError(f"Passkey registration could not be verified: {exc}") from exc

    _consume_challenge(challenge_id)

    credential_id = base64.urlsafe_b64encode(verified.credential_id).decode().rstrip("=")
    with cursor() as cur:
        # A credential id that already belongs to someone else is refused. This
        # was INSERT OR REPLACE, so a replayed registration could move another
        # customer's passkey row to this one.
        cur.execute("SELECT user_id FROM user_credentials WHERE credential_id = ?", (credential_id,))
        owner = cur.fetchone()
        if owner and owner["user_id"] != user_id:
            raise ValueError("That passkey is already registered to another account.")
        cur.execute(
            """INSERT OR REPLACE INTO user_credentials
               (credential_id, user_id, institution_id, public_key, sign_count, device_label)
               VALUES (?, ?, ?, ?, ?, ?)""",
            (
                credential_id,
                user_id,
                institution_id,
                _b64(verified.credential_public_key),
                verified.sign_count,
                device_label or "This device",
            ),
        )
        # Trust the device this passkey was enrolled on, so Shield stops treating
        # transfers from it as coming from an unrecognized device.
        if device_fingerprint:
            cur.execute(
                """INSERT INTO device_profiles (fingerprint_id, user_id, trusted, last_seen)
                   VALUES (?, ?, 1, datetime('now'))
                   ON CONFLICT(fingerprint_id) DO UPDATE SET
                     user_id = excluded.user_id, trusted = 1, last_seen = datetime('now')""",
                (device_fingerprint, user_id),
            )
    return {"credential_id": credential_id, "device_label": device_label or "This device"}


# ---------------------------------------------------------------------------
# WebAuthn — authentication
# ---------------------------------------------------------------------------

def begin_authentication(user_id: str, purpose: str, reference: str | None) -> dict:
    creds = list_credentials(user_id)
    if not creds:
        raise LookupError("No passkey registered for this customer.")

    options = webauthn.generate_authentication_options(
        rp_id=RP_ID,
        allow_credentials=[
            PublicKeyCredentialDescriptor(id=base64url_to_bytes(c["credential_id"])) for c in creds
        ],
        user_verification=UserVerificationRequirement.REQUIRED,
    )
    challenge_id = _store_challenge(
        user_id, "webauthn_auth", _b64(options.challenge), purpose, reference, CHALLENGE_TTL_SECONDS
    )
    return {
        "challenge_id": challenge_id,
        "options": json.loads(webauthn.options_to_json(options)),
    }


def complete_authentication(user_id: str, challenge_id: str, credential: dict) -> dict:
    stored = _take_challenge(challenge_id, user_id, "webauthn_auth")
    if not stored:
        record_failure(user_id, "webauthn_auth", "challenge_invalid")
        raise ValueError("Verification challenge expired or already used.")

    raw_id = credential.get("id") or credential.get("rawId")
    with cursor() as cur:
        cur.execute(
            "SELECT * FROM user_credentials WHERE credential_id = ? AND user_id = ?",
            (raw_id, user_id),
        )
        cred_row = row_to_dict(cur.fetchone())
    if not cred_row:
        record_failure(user_id, "webauthn_auth", "unknown_credential")
        raise ValueError("That passkey isn't registered to this customer.")

    try:
        verified = webauthn.verify_authentication_response(
            credential=credential,
            expected_challenge=_unb64(stored["payload"]),
            expected_rp_id=RP_ID,
            expected_origin=EXPECTED_ORIGINS,
            credential_public_key=_unb64(cred_row["public_key"]),
            credential_current_sign_count=cred_row["sign_count"] or 0,
            # Money moves on this assertion, so the authenticator must have
            # checked the person (biometric or device PIN), not just presence.
            require_user_verification=True,
        )
    except Exception as exc:
        record_failure(user_id, "webauthn_auth", type(exc).__name__)
        raise ValueError(f"Biometric verification failed: {exc}") from exc

    _consume_challenge(challenge_id)
    with cursor() as cur:
        cur.execute(
            "UPDATE user_credentials SET sign_count = ?, last_used_at = ? WHERE credential_id = ?",
            (verified.new_sign_count, _now().isoformat(), raw_id),
        )

    return {"purpose": stored["purpose"], "reference": stored["reference"],
            "credential_id": raw_id, "enrolled_at": cred_row.get("created_at")}


# ---------------------------------------------------------------------------
# Email OTP — the out-of-band factor
# ---------------------------------------------------------------------------

def _hash_otp(code: str, challenge_id: str) -> str:
    """OTPs are stored hashed, so a database read can't hand over live codes."""
    return hmac.new(challenge_id.encode(), code.encode(), hashlib.sha256).hexdigest()


def send_otp(user_id: str, purpose: str, reference: str | None,
             email: str | None = None, phone: str | None = None,
             channel: str = "email") -> dict:
    code = f"{secrets.randbelow(1_000_000):06d}"
    challenge_id = f"chl_{secrets.token_hex(12)}"
    with cursor() as cur:
        cur.execute(
            """INSERT INTO stepup_challenges
               (challenge_id, user_id, kind, payload, purpose, reference, expires_at)
               VALUES (?, ?, 'otp', ?, ?, ?, ?)""",
            (challenge_id, user_id, _hash_otp(code, challenge_id), purpose, reference, _expiry(OTP_TTL_SECONDS)),
        )

    if channel == "sms" and phone:
        delivered = _deliver_otp_sms(phone, code)
        destination = _mask_phone(phone)
    else:
        channel = "email"
        delivered = _deliver_otp_email(email or "", code)
        destination = _mask_email(email or "")

    out = {
        "challenge_id": challenge_id,
        "delivered": delivered,
        "channel": channel,
        "destination": destination,
        # Kept for the existing client field; the masked destination above is
        # the channel-agnostic name.
        "email": destination,
    }
    if not delivered:
        # An undeliverable code is a FAILED factor, not a weaker one.
        #
        # This used to attach the plaintext code to the response whenever
        # delivery failed — and with no SMS provider wired and SMTP usually
        # unset, delivery fails by default. That handed the out-of-band factor
        # to whoever held the session, which is precisely the attacker the
        # out-of-band tier exists to stop: `assurance.py` defines it as "a code
        # delivered to the registered address, so possession of the device is
        # not possession of the channel". Returning it in the response collapses
        # passkey_and_otp to passkey, and pin+otp to pin.
        #
        # It is now gated on an explicit opt-in that is never set in production,
        # and never on delivery failure alone.
        if config.ALLOW_DEBUG_OTP:
            out["debug_code"] = code
        else:
            raise OtpDeliveryFailed(
                "We couldn't send your code right now. Try another way to verify."
            )
    return out


def _mask_phone(phone: str) -> str:
    digits = "".join(c for c in phone if c.isdigit())
    if len(digits) < 4:
        return "your registered number"
    return f"{'•' * max(len(digits) - 4, 3)}{digits[-4:]}"


def _deliver_otp_sms(phone: str, code: str) -> bool:
    """Send the code by SMS. No provider is configured in this environment
    (Termii/Twilio would slot in here), so this returns False and the caller
    surfaces the code as a debug fallback — the same honest path email uses."""
    if not getattr(config, "SMS_PROVIDER_KEY", ""):
        return False
    return False  # provider wiring goes here


def _mask_email(email: str) -> str:
    name, _, domain = email.partition("@")
    if not domain:
        return "your registered address"
    shown = name[:2] if len(name) > 2 else name[:1]
    return f"{shown}{'•' * max(len(name) - len(shown), 2)}@{domain}"


def _deliver_otp_email(email: str, code: str) -> bool:
    from services import mailer

    return mailer.send(
        email, f"Your Fable verification code: {code}",
        f"Your verification code is {code}. It expires in 10 minutes.\n\n"
        "If you did not request this, someone may be trying to move money from your account. "
        "Do not share this code with anyone, including staff.",
    )


def verify_otp(user_id: str, challenge_id: str, code: str) -> dict:
    stored = _take_challenge(challenge_id, user_id, "otp")
    if not stored:
        record_failure(user_id, "otp", "challenge_invalid")
        raise ValueError("That code has expired. Request a new one.")

    if (stored["attempts"] or 0) >= MAX_OTP_ATTEMPTS:
        _consume_challenge(challenge_id)
        record_failure(user_id, "otp", "too_many_attempts")
        raise ValueError("Too many incorrect attempts. Request a new code.")

    # Constant-time compare so a caller can't time their way to the code.
    if not hmac.compare_digest(_hash_otp(code.strip(), challenge_id), stored["payload"]):
        with cursor() as cur:
            cur.execute(
                "UPDATE stepup_challenges SET attempts = attempts + 1 WHERE challenge_id = ?",
                (challenge_id,),
            )
        record_failure(user_id, "otp", "wrong_code")
        raise ValueError("That code isn't right.")

    _consume_challenge(challenge_id)
    return {"purpose": stored["purpose"], "reference": stored["reference"]}
