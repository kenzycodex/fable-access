"""Step-up for an operator's most sensitive actions (integration keys).

Signing in proves who an operator is; changing a key also has to prove they are
at the keyboard now. Every secret action carries one fresh factor:

  * a passkey (WebAuthn), preferred: phishing-resistant and bound to the site;
  * or a 6-digit code from their authenticator app, which cannot be reused
    (each code is accepted only for a later time step than the last).

Five failed step-ups lock secret actions for that operator for 15 minutes.
Only secret actions: the operator can still sign in and do everything else,
so a typo storm cannot lock someone out of the platform.
"""
from __future__ import annotations

import base64
import json
import secrets
from datetime import datetime, timedelta, timezone

from fastapi import HTTPException

from core import config, operators, totp
from core.db import cursor, row_to_dict

MAX_FAILURES = 5
LOCK_MINUTES = 15
CHALLENGE_SECONDS = 180


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _who(email: str) -> str:
    # Challenges share the step-up table with customers', under a prefix no
    # customer id can take.
    return f"operator:{email}"


def _b64(raw: bytes) -> str:
    return base64.b64encode(raw).decode()


# ── Passkeys ─────────────────────────────────────────────────────────────────

def passkeys(email: str) -> list[dict]:
    with cursor() as cur:
        cur.execute(
            "SELECT credential_id, label, created_at, last_used_at FROM operator_passkeys WHERE email = ? ORDER BY created_at",
            (email,),
        )
        return [row_to_dict(r) for r in cur.fetchall()]


def _store_challenge(email: str, kind: str, challenge: bytes) -> str:
    cid = f"opc_{secrets.token_hex(12)}"
    with cursor() as cur:
        cur.execute(
            """INSERT INTO stepup_challenges (challenge_id, user_id, kind, payload, purpose, expires_at)
               VALUES (?, ?, ?, ?, 'operator', ?)""",
            (cid, _who(email), kind, _b64(challenge), (_now() + timedelta(seconds=CHALLENGE_SECONDS)).isoformat()),
        )
    return cid


def _take_challenge(cid: str, email: str, kind: str) -> bytes | None:
    """The challenge bytes, once: it is consumed whether or not it then verifies."""
    with cursor() as cur:
        cur.execute("SELECT * FROM stepup_challenges WHERE challenge_id = ?", (cid,))
        row = row_to_dict(cur.fetchone())
        if not row or row["user_id"] != _who(email) or row["kind"] != kind or row["consumed"]:
            return None
        cur.execute("UPDATE stepup_challenges SET consumed = 1 WHERE challenge_id = ?", (cid,))
    try:
        if datetime.fromisoformat(row["expires_at"]) < _now():
            return None
    except ValueError:
        return None
    return base64.b64decode(row["payload"])


def begin_passkey_registration(op: dict) -> dict:
    import webauthn
    from webauthn.helpers import base64url_to_bytes
    from webauthn.helpers.structs import (
        AuthenticatorSelectionCriteria,
        PublicKeyCredentialDescriptor,
        ResidentKeyRequirement,
        UserVerificationRequirement,
    )

    options = webauthn.generate_registration_options(
        rp_id=config.WEBAUTHN_RP_ID,
        rp_name="Fable Operator",
        user_id=op["email"].encode(),
        user_name=op["email"],
        user_display_name=op.get("name") or op["email"],
        exclude_credentials=[PublicKeyCredentialDescriptor(id=base64url_to_bytes(p["credential_id"])) for p in passkeys(op["email"])],
        authenticator_selection=AuthenticatorSelectionCriteria(
            resident_key=ResidentKeyRequirement.PREFERRED,
            user_verification=UserVerificationRequirement.REQUIRED,
        ),
    )
    return {"challenge_id": _store_challenge(op["email"], "op_passkey_register", options.challenge),
            "options": json.loads(webauthn.options_to_json(options))}


def complete_passkey_registration(op: dict, challenge_id: str, credential: dict, label: str | None) -> dict:
    import webauthn

    challenge = _take_challenge(challenge_id, op["email"], "op_passkey_register")
    if challenge is None:
        raise HTTPException(status_code=400, detail="That passkey prompt expired. Try again.")
    try:
        verified = webauthn.verify_registration_response(
            credential=credential, expected_challenge=challenge,
            expected_rp_id=config.WEBAUTHN_RP_ID, expected_origin=config.WEBAUTHN_ORIGINS,
            require_user_verification=True,
        )
    except Exception as exc:  # noqa: BLE001 - any verification failure is a refusal
        raise HTTPException(status_code=400, detail="The passkey could not be verified.") from exc
    credential_id = base64.urlsafe_b64encode(verified.credential_id).decode().rstrip("=")
    with cursor() as cur:
        cur.execute(
            "INSERT OR REPLACE INTO operator_passkeys (credential_id, email, public_key, sign_count, label) VALUES (?, ?, ?, ?, ?)",
            (credential_id, op["email"], _b64(verified.credential_public_key), verified.sign_count,
             (label or "Passkey").strip()[:60]),
        )
    return {"credential_id": credential_id, "label": (label or "Passkey").strip()[:60]}


def remove_passkey(op: dict, credential_id: str) -> None:
    with cursor() as cur:
        cur.execute("DELETE FROM operator_passkeys WHERE credential_id = ? AND email = ?", (credential_id, op["email"]))
        if cur.rowcount == 0:
            raise HTTPException(status_code=404, detail="Passkey not found.")


# ── Step-up ──────────────────────────────────────────────────────────────────

def options(op: dict) -> dict:
    """What this operator can step up with, and a passkey challenge if they have one."""
    import webauthn
    from webauthn.helpers import base64url_to_bytes
    from webauthn.helpers.structs import PublicKeyCredentialDescriptor, UserVerificationRequirement

    keys = passkeys(op["email"])
    out: dict = {"totp": bool(op.get("totp_secret")), "passkey": None, "locked_until": locked_until(op["email"])}
    if keys:
        opts = webauthn.generate_authentication_options(
            rp_id=config.WEBAUTHN_RP_ID,
            allow_credentials=[PublicKeyCredentialDescriptor(id=base64url_to_bytes(k["credential_id"])) for k in keys],
            user_verification=UserVerificationRequirement.REQUIRED,
        )
        out["passkey"] = {"challenge_id": _store_challenge(op["email"], "op_passkey_auth", opts.challenge),
                          "options": json.loads(webauthn.options_to_json(opts))}
    return out


def locked_until(email: str) -> str | None:
    with cursor() as cur:
        cur.execute("SELECT locked_until FROM operator_stepup WHERE email = ?", (email,))
        row = cur.fetchone()
    if not row or not row["locked_until"]:
        return None
    try:
        return row["locked_until"] if datetime.fromisoformat(row["locked_until"]) > _now() else None
    except ValueError:
        return None


def _failed(op: dict, reason: str) -> None:
    from services import secret_admin

    with cursor() as cur:
        cur.execute(
            """INSERT INTO operator_stepup (email, failures) VALUES (?, 1)
               ON CONFLICT(email) DO UPDATE SET failures = failures + 1""",
            (op["email"],),
        )
        cur.execute("SELECT failures FROM operator_stepup WHERE email = ?", (op["email"],))
        failures = cur.fetchone()["failures"]
        locked = failures >= MAX_FAILURES
        if locked:
            cur.execute("UPDATE operator_stepup SET failures = 0, locked_until = ? WHERE email = ?",
                        ((_now() + timedelta(minutes=LOCK_MINUTES)).isoformat(), op["email"]))
    secret_admin.log_event("operator.secret_stepup_failed", actor=op["email"], detail={"reason": reason, "failures": failures})
    if locked:
        secret_admin.log_event("operator.secret_locked", actor=op["email"], detail={"minutes": LOCK_MINUTES})
        secret_admin.alert_owners(
            "Secret actions locked for an operator",
            f"{op['email']} failed step-up verification {MAX_FAILURES} times. Their key-management actions are "
            f"locked for {LOCK_MINUTES} minutes. Their sign-in is not affected.",
        )
        raise HTTPException(status_code=423, detail=f"Too many failed verifications. Key actions are locked for {LOCK_MINUTES} minutes.")
    raise HTTPException(status_code=401, detail="That verification didn't work. Try again.")


def verify(op: dict, step_up: dict | None) -> str:
    """Check one fresh factor for a secret action. Returns "passkey" or "totp"."""
    if locked_until(op["email"]):
        raise HTTPException(status_code=423, detail=f"Key actions are locked for {LOCK_MINUTES} minutes after repeated failed verifications.")
    step_up = step_up or {}
    if step_up.get("passkey") and step_up.get("challenge_id"):
        return _verify_passkey(op, step_up["challenge_id"], step_up["passkey"])
    if step_up.get("code"):
        secret = op.get("totp_secret")
        step = totp.verify(operators.unseal(secret), str(step_up["code"]), op.get("totp_last_step")) if secret else None
        if step is None:
            _failed(op, "wrong_code")
        with cursor() as cur:
            cur.execute("UPDATE operators SET totp_last_step = ? WHERE email = ?", (step, op["email"]))
            cur.execute("UPDATE operator_stepup SET failures = 0 WHERE email = ?", (op["email"],))
        return "totp"
    raise HTTPException(status_code=401, detail="Confirm with your passkey or a code from your authenticator app.")


def _verify_passkey(op: dict, challenge_id: str, credential: dict) -> str:
    import webauthn

    challenge = _take_challenge(challenge_id, op["email"], "op_passkey_auth")
    raw_id = (credential or {}).get("id") or (credential or {}).get("rawId")
    with cursor() as cur:
        cur.execute("SELECT * FROM operator_passkeys WHERE credential_id = ? AND email = ?", (raw_id, op["email"]))
        row = row_to_dict(cur.fetchone())
    if challenge is None or not row:
        _failed(op, "passkey_challenge_or_credential")
    try:
        verified = webauthn.verify_authentication_response(
            credential=credential, expected_challenge=challenge,
            expected_rp_id=config.WEBAUTHN_RP_ID, expected_origin=config.WEBAUTHN_ORIGINS,
            credential_public_key=base64.b64decode(row["public_key"]),
            credential_current_sign_count=row["sign_count"] or 0, require_user_verification=True,
        )
    except Exception:  # noqa: BLE001 - any verification failure is a refusal
        _failed(op, "passkey_invalid")
    with cursor() as cur:
        cur.execute("UPDATE operator_passkeys SET sign_count = ?, last_used_at = datetime('now') WHERE credential_id = ?",
                    (verified.new_sign_count, raw_id))
        cur.execute("UPDATE operator_stepup SET failures = 0 WHERE email = ?", (op["email"],))
    return "passkey"
