"""Changing an integration key: propose, approve, apply, roll back, remove.

The rules, in order of what they protect against:

* Only platform owners act, each action with a fresh passkey or authenticator
  step-up (core/operator_stepup.py).
* Maker-checker. A change waits for a *different* owner to approve it (24 h,
  then it expires). With only one owner it is held for a 12-hour cooling-off
  period instead, every owner is emailed straight away, and anyone can cancel.
* A new key is tested against its provider before it is accepted, and again
  before a rollback. A key that fails is refused.
* A key rotated because it was compromised is revoked at once: its stored
  value is wiped, and it can never be rolled back to. A key retired in a
  routine rotation stays (encrypted) for 7 days for rollback, then is wiped.
* Proposed values are envelope-encrypted like stored ones, bound to their
  change, and wiped as soon as the change is decided.
* Every action is written to a hash-chained log (secret_audit), to the main
  audit log, and to the log stream (and Sentry when configured), so a record
  exists outside the database too. Values never appear in any of them.
"""
from __future__ import annotations

import hashlib
import json
import logging
import secrets as pysecrets
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timedelta, timezone

from fastapi import HTTPException

from core import config, integrations
from core import secrets as vault
from core.db import cursor, row_to_dict
from services import approvals
from services.approvals import APPROVAL_HOURS, COOLING_HOURS

logger = logging.getLogger("fable.secrets.audit")

ROLLBACK_DAYS = 7
REASONS = ("routine", "compromised")


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _iso(dt: datetime) -> str:
    return dt.strftime("%Y-%m-%d %H:%M:%S")


# ── Audit: chained, mirrored, never a value ──────────────────────────────────

GENESIS = "0" * 64


def _row_hash(prev: str, at: str, event: str, name, version, change_id, actor, detail: str) -> str:
    body = json.dumps([prev, at, event, name, version, change_id, actor, detail], separators=(",", ":"), ensure_ascii=False)
    return hashlib.sha256(body.encode()).hexdigest()


def log_event(event: str, *, actor: str | None, name: str | None = None, version: int | None = None,
              change_id: str | None = None, detail: dict | None = None) -> None:
    detail_json = json.dumps(detail or {}, sort_keys=True, ensure_ascii=False, default=str)
    at = _iso(_now())
    with cursor() as cur:
        cur.execute("SELECT hash FROM secret_audit ORDER BY id DESC LIMIT 1")
        row = cur.fetchone()
        prev = row["hash"] if row else GENESIS
        digest = _row_hash(prev, at, event, name, version, change_id, actor, detail_json)
        cur.execute(
            """INSERT INTO secret_audit (at, event, name, version, change_id, actor, detail, prev_hash, hash)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            (at, event, name, version, change_id, actor, detail_json, prev, digest),
        )
    from services import audit

    audit.record(event, None, operator=actor, secret=name, version=version, change_id=change_id, **(detail or {}))
    # Off the database: the log stream (docker logs, any shipper) and Sentry.
    line = json.dumps({"secret_audit": event, "at": at, "name": name, "version": version, "change_id": change_id,
                       "actor": actor, "detail": detail or {}, "hash": digest}, default=str)
    logger.warning(line)
    if config.SENTRY_DSN or vault.get("SENTRY_DSN"):
        try:
            import sentry_sdk

            sentry_sdk.capture_message(f"secret_audit {event} {name or ''}".strip(), level="info")
        except Exception:  # noqa: BLE001
            pass


def verify_chain() -> tuple[bool, int, str | None]:
    """(intact, rows checked, first broken row id)."""
    with cursor() as cur:
        cur.execute("SELECT * FROM secret_audit ORDER BY id")
        rows = [row_to_dict(r) for r in cur.fetchall()]
    prev = GENESIS
    for r in rows:
        expected = _row_hash(prev, r["at"], r["event"], r["name"], r["version"], r["change_id"], r["actor"], r["detail"])
        if r["prev_hash"] != prev or r["hash"] != expected:
            return False, len(rows), str(r["id"])
        prev = r["hash"]
    return True, len(rows), None


def _reserved(email: str) -> bool:
    """Addresses that can never receive mail (RFC 2606 / 6761 names). Mail to
    them only bounces back to our own sending mailbox."""
    domain = email.rsplit("@", 1)[-1].lower()
    return domain.endswith((".test", ".example", ".invalid", ".localhost")) or domain in ("test", "example", "invalid", "localhost")


def alert_owners(subject: str, body: str, exclude: str | None = None, path: str = "/operator/secrets",
                 closing: str = "If you did not expect this, cancel it there and rotate the key.") -> None:
    """Email every platform owner. Best effort: a missing mail server never
    blocks the action, which is already in the audit trail."""
    from services import mailer

    if not mailer.configured():
        return
    with cursor() as cur:
        cur.execute("SELECT email FROM operators WHERE role = 'platform_owner' AND active = 1")
        owners = [r["email"] for r in cur.fetchall() if r["email"] != exclude and not _reserved(r["email"])]
    for email in owners:
        mailer.send(
            email, f"[Fable security] {subject}",
            f"{body}\n\nReview it in the operator console: {integrations.frontend_url()}{path}\n{closing}",
        )


# ── Provider tests ───────────────────────────────────────────────────────────

def _http_ok(url: str, headers: dict | None = None, ok=lambda status, body: status == 200) -> tuple[bool, str]:
    req = urllib.request.Request(url, headers=headers or {})
    try:
        with urllib.request.urlopen(req, timeout=8) as resp:  # noqa: S310 - fixed provider URLs
            body = resp.read(4096).decode("utf-8", "ignore")
            return (True, "Accepted by the provider.") if ok(resp.status, body) else (False, "The provider did not accept it.")
    except urllib.error.HTTPError as exc:
        return False, f"Rejected by the provider (HTTP {exc.code})."
    except Exception as exc:  # noqa: BLE001 - never echo provider text, which can contain the key
        return False, f"Could not reach the provider ({type(exc).__name__})."


_LAT, _LON = "6.5244", "3.3792"  # Lagos, for the address probes

PROBES = {
    "openai": lambda v: _http_ok("https://api.openai.com/v1/models", {"Authorization": f"Bearer {v}"}),
    "anthropic": lambda v: _http_ok("https://api.anthropic.com/v1/models",
                                    {"x-api-key": v, "anthropic-version": "2023-06-01"}),
    "locationiq": lambda v: _http_ok(
        f"https://us1.locationiq.com/v1/reverse?{urllib.parse.urlencode({'key': v, 'lat': _LAT, 'lon': _LON, 'format': 'json'})}"),
    "geoapify": lambda v: _http_ok(
        f"https://api.geoapify.com/v1/geocode/reverse?{urllib.parse.urlencode({'apiKey': v, 'lat': _LAT, 'lon': _LON})}"),
    "termii": lambda v: _http_ok(
        f"{config.TERMII_BASE_URL}/api/get-balance?{urllib.parse.urlencode({'api_key': v})}"),
    "africastalking": lambda v: _http_ok(
        f"{_at_base()}/version1/user?{urllib.parse.urlencode({'username': _at_username()})}",
        {"apiKey": v, "Accept": "application/json"}),
    "google": lambda v: _http_ok(
        f"https://maps.googleapis.com/maps/api/geocode/json?{urllib.parse.urlencode({'key': v, 'latlng': f'{_LAT},{_LON}'})}",
        ok=lambda status, body: status == 200 and '"status" : "OK"' in body.replace('"status":"OK"', '"status" : "OK"')),
}


def _at_base() -> str:
    from core import integrations

    return config.AFRICASTALKING_URLS.get(integrations.sms()["africastalking_env"],
                                          config.AFRICASTALKING_URLS["sandbox"])


def _at_username() -> str:
    from core import integrations

    return integrations.sms()["africastalking_username"] or "sandbox"


def test_value(name: str, value: str) -> tuple[bool, str]:
    spec = vault.MANAGED[name]
    if spec.kind == "config":
        try:
            vault.parse_setting(spec, value)
            return True, "Valid setting."
        except ValueError as exc:
            return False, str(exc)
    if spec.kind == "model":
        return (value in vault.allowed_models(name), "Allowed model." if value in vault.allowed_models(name)
                else "That model is not on the allowlist.")
    if not spec.probe:
        # Nothing to call with the value alone (a mail password, a DSN); the
        # console's "send a test" actions check these end to end.
        return True, "Stored as given. Use the send-a-test action to check it."
    ok, message = PROBES[spec.probe](value)
    return ok, vault.scrub(message)


# ── Reading the state ────────────────────────────────────────────────────────

def _owners() -> list[str]:
    return approvals.owners()


def _public_change(c: dict) -> dict:
    return {k: c.get(k) for k in ("id", "name", "action", "status", "rotation_reason", "reason", "target_version", "note",
                                   "last4", "fingerprint", "proposed_by", "single_approver", "decided_by", "decided_at",
                                   "apply_after", "expires_at", "created_at")}


def overview() -> dict:
    sweep()
    with cursor() as cur:
        cur.execute("SELECT name, version, status, last4, fingerprint, rotation_reason, set_by, approved_by, created_at, "
                    "retired_at, note FROM platform_secrets ORDER BY name, version DESC")
        versions = [row_to_dict(r) for r in cur.fetchall()]
        cur.execute("SELECT * FROM secret_changes WHERE status IN ('pending', 'cooling') ORDER BY created_at DESC")
        pending = [_public_change(row_to_dict(r)) for r in cur.fetchall()]
    items = []
    for name, spec in vault.MANAGED.items():
        mine = [v for v in versions if v["name"] == name]
        active = next((v for v in mine if v["status"] == "active"), None)
        src = "environment" if vault.env_value(name) else ("console" if active else "unset")
        due = None
        if active and spec.rotate_days and active.get("created_at"):
            try:
                due = _iso(datetime.fromisoformat(active["created_at"]).replace(tzinfo=timezone.utc) + timedelta(days=spec.rotate_days))
            except ValueError:
                due = None
        env_val = vault.env_value(name)
        if spec.kind == "config":
            current = vault.setting(name)
            display = ("true" if current else "false") if spec.value_type == "bool" else vault.display_number(current) if isinstance(current, (int, float)) else str(current)
            default = getattr(config, spec.config_attr) if spec.config_attr else None
            default = ("true" if default else "false") if spec.value_type == "bool" else str(default)
        else:
            display = (env_val if spec.kind == "model" else vault.last4(env_val)) if env_val else (active or {}).get("last4")
            default = spec.default or None
        items.append({
            "name": name, "label": spec.label, "group": spec.group, "kind": spec.kind, "source": src,
            "display": display,
            "default": default,
            "unit": spec.unit or None, "help": spec.help or None,
            "choices": list(spec.choices) or None, "value_type": spec.value_type,
            "minimum": spec.minimum, "maximum": spec.maximum,
            "note": (active or {}).get("note"),
            "active": active, "rotation_due": due, "rotate_days": spec.rotate_days,
            "versions": [v for v in mine if v["status"] != "active"][:5],
            "allowed_models": vault.allowed_models(name) if spec.kind == "model" else None,
        })
    return {"items": items, "pending": pending, "owners": len(_owners()), "write_enabled": config.SECRETS_WRITE,
            "master_key": vault.master_key() is not None, "key_id": config.SECRETS_KEY_ID}


# ── Changing ─────────────────────────────────────────────────────────────────

def _writable(name: str) -> vault.Spec:
    if not config.SECRETS_WRITE:
        raise HTTPException(status_code=423, detail="Key changes are switched off on this server (FABLE_SECRETS_WRITE=off).")
    if vault.master_key() is None:
        raise HTTPException(status_code=409, detail="FABLE_SECRETS_KEY is not set on the server, so keys cannot be stored here.")
    spec = vault.MANAGED.get(name)
    if not spec:
        raise HTTPException(status_code=404, detail="That key is not managed from the console.")
    if vault.env_value(name):
        raise HTTPException(status_code=409, detail="This key is set in the server environment, which takes precedence. "
                                                    "Remove it from .env to manage it here.")
    return spec


def _clean_value(spec: vault.Spec, value: str) -> str:
    value = (value or "").strip()
    if spec.kind == "config":
        try:
            parsed = vault.parse_setting(spec, value)
        except ValueError as exc:
            raise HTTPException(status_code=422, detail=f"{spec.label}: {exc}") from exc
        return ("true" if parsed else "false") if spec.value_type == "bool" else str(parsed)
    if spec.kind == "model":
        if value not in vault.allowed_models(spec.name):
            raise HTTPException(status_code=422, detail="Choose a model from the allowlist.")
        return value
    if not 8 <= len(value) <= 512 or (not spec.allow_spaces and any(ch.isspace() for ch in value)):
        raise HTTPException(status_code=422, detail="That doesn't look like a key: 8 to 512 characters, no spaces.")
    return value


def _new_change(name: str, action: str, op_email: str, reason: str, rotation: str | None,
                value: str | None = None, target_version: int | None = None, kind: str = "secret",
                note: str | None = None) -> dict:
    wait = approvals.plan()
    single = wait["single"]
    cid = f"chg_{pysecrets.token_hex(10)}"
    sealed = vault.seal(value, name, cid, purpose="pending") if value is not None else {}
    status = wait["status"]
    with cursor() as cur:
        cur.execute(
            """INSERT INTO secret_changes (id, name, action, status, rotation_reason, reason, target_version, ciphertext,
                 nonce, wrapped_key, kid, last4, fingerprint, proposed_by, single_approver, apply_after, expires_at, note)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            (cid, name, action, status, rotation, reason, target_version, sealed.get("ciphertext"), sealed.get("nonce"),
             sealed.get("wrapped_key"), sealed.get("kid"),
             vault.last4(value, kind) if value else None, vault.fingerprint(value) if value else None,
             op_email, int(single), wait["apply_after"], wait["expires_at"], (note or "").strip()[:200] or None),
        )
        cur.execute("SELECT * FROM secret_changes WHERE id = ?", (cid,))
        change = row_to_dict(cur.fetchone())
    log_event(f"secret.{action}_proposed", actor=op_email, name=name, change_id=cid,
              detail={"reason": reason, "rotation": rotation, "single_approver": single,
                      "fingerprint": change["fingerprint"], "target_version": target_version})
    if single:
        alert_owners(f"{name} change held for {COOLING_HOURS} hours",
                     f"{op_email} proposed to {action} {name} ({reason}). There is only one platform owner, so it "
                     f"applies automatically after a {COOLING_HOURS}-hour cooling-off period unless cancelled.")
    else:
        alert_owners(f"{name} change needs your approval",
                     f"{op_email} proposed to {action} {name} ({reason}). Another owner must approve it within "
                     f"{APPROVAL_HOURS} hours.", exclude=op_email)
    return _public_change(change)


def _checked(op: dict, name: str, value: str, rotation: str) -> tuple:
    """A proposed value, cleaned and tested, or a 422 saying why not."""
    spec = _writable(name)
    if rotation not in REASONS:
        raise HTTPException(status_code=422, detail="Say whether this is a routine rotation or a compromised key.")
    value = _clean_value(spec, value)
    ok, message = test_value(name, value)
    if not ok:
        log_event("secret.test_failed", actor=op["email"], name=name, detail={"message": message, "stage": "propose"})
        raise HTTPException(status_code=422, detail=f"{name} was refused: {message}")
    return spec, value


def propose(op: dict, name: str, value: str, reason: str, rotation: str, note: str | None = None) -> dict:
    spec, value = _checked(op, name, value, rotation)
    return _new_change(name, "set", op["email"], reason, rotation, value=value, kind=spec.kind, note=note)


def propose_many(op: dict, items: list[dict], reason: str) -> list[dict]:
    """Several values in one go, under one step-up. Every value is checked
    first; if any is refused, none is proposed."""
    names = [i["name"] for i in items]
    if len(set(names)) != len(names):
        raise HTTPException(status_code=422, detail="Each variable can appear only once.")
    checked = [(_checked(op, i["name"], i["value"], i.get("rotation") or "routine"), i) for i in items]
    return [_new_change(i["name"], "set", op["email"], reason, i.get("rotation") or "routine", value=value,
                        kind=spec.kind, note=i.get("note")) for (spec, value), i in checked]


def propose_rollback(op: dict, name: str, version: int, reason: str) -> dict:
    spec = _writable(name)
    with cursor() as cur:
        cur.execute("SELECT * FROM platform_secrets WHERE name = ? AND version = ?", (name, version))
        row = row_to_dict(cur.fetchone())
    if not row:
        raise HTTPException(status_code=404, detail="That version does not exist.")
    if row["status"] == "revoked":
        raise HTTPException(status_code=409, detail="That version was retired as compromised. It can never be restored.")
    if row["status"] != "retired" or not row.get("ciphertext"):
        raise HTTPException(status_code=409, detail="Only a recently retired version can be restored.")
    value = vault.open_sealed(row, name, version)
    ok, message = test_value(name, value)
    if not ok:
        log_event("secret.test_failed", actor=op["email"], name=name, version=version,
                  detail={"message": message, "stage": "rollback"})
        raise HTTPException(status_code=422, detail=f"The old key no longer works: {message}")
    return _new_change(name, "rollback", op["email"], reason, "rollback", value=value, target_version=version, kind=spec.kind)


def propose_removal(op: dict, name: str, reason: str) -> dict:
    _writable(name)
    if vault.source(name) != "console":
        raise HTTPException(status_code=409, detail="There is no key stored from the console to remove.")
    return _new_change(name, "remove", op["email"], reason, None)


def _change(cid: str) -> dict:
    with cursor() as cur:
        cur.execute("SELECT * FROM secret_changes WHERE id = ?", (cid,))
        row = row_to_dict(cur.fetchone())
    if not row:
        raise HTTPException(status_code=404, detail="That change does not exist.")
    return row


def _wipe(cid: str, status: str, by: str | None) -> None:
    with cursor() as cur:
        cur.execute(
            """UPDATE secret_changes SET status = ?, ciphertext = NULL, nonce = NULL, wrapped_key = NULL,
                 decided_by = COALESCE(?, decided_by), decided_at = datetime('now') WHERE id = ?""",
            (status, by, cid),
        )


def approve(op: dict, cid: str) -> dict:
    c = _change(cid)
    if c["status"] != "pending":
        raise HTTPException(status_code=409, detail="That change is not waiting for approval.")
    approvals.ensure_checker(c["proposed_by"], op["email"])
    _writable(c["name"])
    return _apply(c, approver=op["email"])


def reject(op: dict, cid: str, reason: str | None = None) -> dict:
    c = _change(cid)
    if c["status"] not in ("pending", "cooling"):
        raise HTTPException(status_code=409, detail="That change has already been decided.")
    status = "cancelled" if c["proposed_by"] == op["email"] else "rejected"
    _wipe(cid, status, op["email"])
    log_event(f"secret.change_{status}", actor=op["email"], name=c["name"], change_id=cid, detail={"reason": reason})
    alert_owners(f"{c['name']} change {status}", f"{op['email']} {status} the proposed change to {c['name']}.")
    return _public_change(_change(cid))


def _apply(c: dict, approver: str | None) -> dict:
    name, cid = c["name"], c["id"]
    spec = vault.MANAGED[name]
    value = vault.open_sealed(c, name, cid, purpose="pending") if c.get("ciphertext") else None
    if value is not None and c["action"] in ("set", "rollback") and spec.kind == "secret":
        ok, message = test_value(name, value)
        if not ok:
            _wipe(cid, "rejected", approver or "system")
            log_event("secret.test_failed", actor=approver or "system", name=name, change_id=cid,
                      detail={"message": message, "stage": "apply"})
            raise HTTPException(status_code=422, detail=f"The key failed its test when applied: {message}")
    with cursor() as cur:
        if c["action"] == "remove":
            cur.execute("DELETE FROM platform_secrets WHERE name = ?", (name,))
            version = None
        else:
            cur.execute("SELECT COALESCE(MAX(version), 0) + 1 AS v FROM platform_secrets WHERE name = ?", (name,))
            version = cur.fetchone()["v"]
            compromised = c["rotation_reason"] == "compromised"
            # The key being replaced: revoked and wiped if compromised, otherwise kept for rollback.
            cur.execute(
                f"""UPDATE platform_secrets SET status = ?, retired_at = datetime('now')
                       {', ciphertext = NULL, nonce = NULL, wrapped_key = NULL' if compromised else ''}
                    WHERE name = ? AND status = 'active'""",
                ("revoked" if compromised else "retired", name),
            )
            sealed = vault.seal(value, name, version)
            cur.execute(
                """INSERT INTO platform_secrets (name, version, status, ciphertext, nonce, wrapped_key, kid, last4,
                     fingerprint, rotation_reason, set_by, approved_by, change_id, note)
                   VALUES (?, ?, 'active', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                (name, version, sealed["ciphertext"], sealed["nonce"], sealed["wrapped_key"], sealed["kid"],
                 vault.last4(value, spec.kind), vault.fingerprint(value), c["rotation_reason"] or "routine",
                 c["proposed_by"], approver or ("cooling-off" if c["single_approver"] else None), cid, c.get("note")),
            )
    _wipe(cid, "applied", approver or "system")
    vault.bump_generation()
    log_event(f"secret.{c['action']}_applied", actor=approver or "system (cooling-off ended)", name=name,
              version=version, change_id=cid,
              detail={"proposed_by": c["proposed_by"], "single_approver": bool(c["single_approver"]),
                      "rotation": c["rotation_reason"], "fingerprint": c["fingerprint"]})
    alert_owners(f"{name} changed", f"The change to {name} proposed by {c['proposed_by']} was applied"
                 + (f", approved by {approver}." if approver else " after its cooling-off period."))
    return _public_change(_change(cid))


def test_active(op: dict, name: str) -> dict:
    if name not in vault.MANAGED:
        raise HTTPException(status_code=404, detail="That key is not managed here.")
    value = vault.get(name)
    if not value:
        return {"ok": False, "message": "No key is configured."}
    ok, message = test_value(name, value)
    log_event("secret.tested", actor=op["email"], name=name, detail={"ok": ok})
    return {"ok": ok, "message": message}


def sweep() -> None:
    """Expire stale proposals, apply finished cooling-off periods, wipe old versions."""
    now = _iso(_now())
    with cursor() as cur:
        cur.execute("SELECT * FROM secret_changes WHERE status = 'pending' AND expires_at <= ?", (now,))
        expired = [row_to_dict(r) for r in cur.fetchall()]
        cur.execute("SELECT * FROM secret_changes WHERE status = 'cooling' AND apply_after <= ?", (now,))
        due = [row_to_dict(r) for r in cur.fetchall()]
        cur.execute(
            """UPDATE platform_secrets SET ciphertext = NULL, nonce = NULL, wrapped_key = NULL
               WHERE status = 'retired' AND ciphertext IS NOT NULL AND retired_at <= datetime('now', ?)""",
            (f"-{ROLLBACK_DAYS} days",),
        )
    for c in expired:
        _wipe(c["id"], "expired", None)
        log_event("secret.change_expired", actor="system", name=c["name"], change_id=c["id"])
    for c in due:
        try:
            _apply(c, approver=None)
        except HTTPException:
            pass  # recorded by _apply
