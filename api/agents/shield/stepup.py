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

import config
from db import cursor, row_to_dict

CHALLENGE_TTL_SECONDS = 300      # 5 minutes to complete a factor
TOKEN_TTL_SECONDS = 600          # proof is good for 10 minutes
OTP_TTL_SECONDS = 600
MAX_OTP_ATTEMPTS = 5

# Relying Party identity. Must match the origin the browser is on; overridable
# so a deployed instance can set its real domain.
RP_ID = config.WEBAUTHN_RP_ID
RP_NAME = "Fable"
EXPECTED_ORIGINS = config.WEBAUTHN_ORIGINS


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


def record_failure(user_id: str, kind: str, reason: str) -> None:
    with cursor() as cur:
        cur.execute(
            "INSERT INTO stepup_failures (user_id, kind, reason) VALUES (?, ?, ?)",
            (user_id, kind, reason),
        )


def recent_failure_count(user_id: str, within_minutes: int = 60) -> int:
    """Failed factor attempts, fed back to Shield as evidence.

    The cutoff is computed by SQLite rather than Python on purpose. created_at
    defaults to datetime('now'), which writes "2026-07-19 13:00:00", while
    Python's isoformat() produces "2026-07-19T13:00:00+00:00". These are
    compared as strings, and ' ' sorts before 'T', so every row looked older
    than any Python-built cutoff and this always returned zero — silently
    disabling the signal it exists to feed.
    """
    with cursor() as cur:
        cur.execute(
            "SELECT COUNT(*) AS n FROM stepup_failures "
            "WHERE user_id = ? AND created_at >= datetime('now', ?)",
            (user_id, f"-{int(within_minutes)} minutes"),
        )
        return cur.fetchone()["n"]


def issue_token(user_id: str, level: str, purpose: str | None, reference: str | None) -> dict:
    token = f"su_{secrets.token_urlsafe(24)}"
    with cursor() as cur:
        cur.execute(
            """INSERT INTO stepup_tokens (token, user_id, level, purpose, reference, expires_at)
               VALUES (?, ?, ?, ?, ?, ?)""",
            (token, user_id, level, purpose, reference, _expiry(TOKEN_TTL_SECONDS)),
        )
    return {"token": token, "level": level, "expires_in": TOKEN_TTL_SECONDS}


def verify_token(token: str | None, user_id: str, purpose: str | None = None, reference: str | None = None) -> str | None:
    """Return the assurance level a token proves, or None if it proves nothing.

    Binding is checked, not just existence: a token for another user, another
    purpose or another reference is worthless here.
    """
    if not token:
        return None
    with cursor() as cur:
        cur.execute("SELECT * FROM stepup_tokens WHERE token = ?", (token,))
        row = row_to_dict(cur.fetchone())
    if not row:
        return None
    if row["user_id"] != user_id or row["consumed"] or _expired(row["expires_at"]):
        return None
    if purpose and row["purpose"] and row["purpose"] != purpose:
        return None
    if reference and row["reference"] and row["reference"] != reference:
        return None
    return row["level"]


def consume_token(token: str) -> None:
    with cursor() as cur:
        cur.execute("UPDATE stepup_tokens SET consumed = 1 WHERE token = ?", (token,))


# ---------------------------------------------------------------------------
# WebAuthn — registration
# ---------------------------------------------------------------------------

def has_passkey(user_id: str) -> bool:
    with cursor() as cur:
        cur.execute("SELECT 1 FROM user_credentials WHERE user_id = ? LIMIT 1", (user_id,))
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
            user_verification=UserVerificationRequirement.PREFERRED,
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
                          institution_id: str | None) -> dict:
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
        )
    except Exception as exc:
        record_failure(user_id, "webauthn_register", type(exc).__name__)
        raise ValueError(f"Passkey registration could not be verified: {exc}") from exc

    _consume_challenge(challenge_id)

    credential_id = base64.urlsafe_b64encode(verified.credential_id).decode().rstrip("=")
    with cursor() as cur:
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
        user_verification=UserVerificationRequirement.PREFERRED,
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

    return {"purpose": stored["purpose"], "reference": stored["reference"]}


# ---------------------------------------------------------------------------
# Email OTP — the out-of-band factor
# ---------------------------------------------------------------------------

def _hash_otp(code: str, challenge_id: str) -> str:
    """OTPs are stored hashed, so a database read can't hand over live codes."""
    return hmac.new(challenge_id.encode(), code.encode(), hashlib.sha256).hexdigest()


def send_otp(user_id: str, email: str, purpose: str, reference: str | None) -> dict:
    code = f"{secrets.randbelow(1_000_000):06d}"
    challenge_id = f"chl_{secrets.token_hex(12)}"
    with cursor() as cur:
        cur.execute(
            """INSERT INTO stepup_challenges
               (challenge_id, user_id, kind, payload, purpose, reference, expires_at)
               VALUES (?, ?, 'otp', ?, ?, ?, ?)""",
            (challenge_id, user_id, _hash_otp(code, challenge_id), purpose, reference, _expiry(OTP_TTL_SECONDS)),
        )

    delivered = _deliver_otp_email(email, code)
    out = {"challenge_id": challenge_id, "delivered": delivered, "email": _mask_email(email)}
    if not delivered:
        # With no SMTP configured the code is returned so the flow stays
        # testable. Never do this when mail is actually configured.
        out["debug_code"] = code
    return out


def _mask_email(email: str) -> str:
    name, _, domain = email.partition("@")
    if not domain:
        return "your registered address"
    shown = name[:2] if len(name) > 2 else name[:1]
    return f"{shown}{'•' * max(len(name) - len(shown), 2)}@{domain}"


def _deliver_otp_email(email: str, code: str) -> bool:
    if not config.SMTP_USERNAME or not config.SMTP_PASSWORD:
        return False
    import smtplib
    from email.message import EmailMessage

    msg = EmailMessage()
    msg["Subject"] = f"Your Fable verification code: {code}"
    msg["From"] = config.SMTP_FROM
    msg["To"] = email
    msg.set_content(
        f"Your verification code is {code}. It expires in 10 minutes.\n\n"
        "If you did not request this, someone may be trying to move money from your account. "
        "Do not share this code with anyone, including staff."
    )
    try:
        with smtplib.SMTP(config.SMTP_SERVER, config.SMTP_PORT) as server:
            server.starttls()
            server.login(config.SMTP_USERNAME, config.SMTP_PASSWORD)
            server.send_message(msg)
        return True
    except Exception:
        return False


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
