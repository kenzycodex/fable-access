"""The Fable operator platform: provisioning and looking after institutions.

For Fable staff only, with their own accounts and mandatory MFA (see
core/operators.py). A bank's console members cannot reach any of this, and an
operator cannot act as a bank: provisioning creates an empty institution and
invites its owner, who then sets everything else up in their own console.
"""
import logging
import re
import secrets
import smtplib
import time
from email.message import EmailMessage

from fastapi import APIRouter, BackgroundTasks, HTTPException, Query, Request
from pydantic import BaseModel, Field

from core import config, operators, totp
from core.db import cursor, row_to_dict, slugify_institution
from core.tenancy import get_institution, register_institution
from core.utils import hash_password, needs_rehash, verify_password
from services import audit, onboarding

router = APIRouter(prefix="/operator", tags=["operator"])
logger = logging.getLogger("fable.operator")

_EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")
_DUMMY_HASH = hash_password(secrets.token_urlsafe(16))


def _ip(request: Request) -> str:
    return request.client.host if request.client else "unknown"


def _throttle_key(email: str) -> str:
    return f"operator:{email}"


# ── Sign-in ──────────────────────────────────────────────────────────────────

class LoginBody(BaseModel):
    email: str = Field(max_length=200)
    password: str = Field(max_length=200)


@router.post("/auth/login")
def login(body: LoginBody, request: Request):
    """Step one: the password. Returns a five-minute challenge for the code, or,
    on an operator's first sign-in, a new authenticator secret to enrol."""
    from routers.auth import _record_failure, _throttled

    email = body.email.strip().lower()
    if _throttled(_throttle_key(email), _ip(request)):
        raise HTTPException(status_code=429, detail="Too many attempts. Wait 15 minutes and try again.")
    op = operators.get(email)
    if not op or op.get("active") != operators.ACTIVE:
        verify_password(body.password, _DUMMY_HASH)  # the same cost as a real check
        _record_failure(_throttle_key(email), _ip(request))
        raise HTTPException(status_code=401, detail="Incorrect email or password.")
    if not verify_password(body.password, op["hashed_password"]):
        _record_failure(_throttle_key(email), _ip(request))
        raise HTTPException(status_code=401, detail="Incorrect email or password.")
    if needs_rehash(op["hashed_password"]):
        with cursor() as cur:
            cur.execute("UPDATE operators SET hashed_password = ? WHERE email = ?", (hash_password(body.password), email))

    if op.get("totp_enabled"):
        return {"step": "mfa", "challenge": operators.issue_challenge(email, enroll=False)}

    secret = totp.new_secret()
    with cursor() as cur:
        cur.execute("UPDATE operators SET totp_secret = ? WHERE email = ?", (operators.seal(secret), email))
    return {
        "step": "enroll",
        "challenge": operators.issue_challenge(email, enroll=True),
        "secret": secret,
        "otpauth_uri": totp.provisioning_uri(secret, email),
    }


class VerifyBody(BaseModel):
    challenge: str = Field(max_length=2000)
    code: str = Field(max_length=12)


@router.post("/auth/verify")
def verify(body: VerifyBody, request: Request):
    """Step two: the authenticator code. Returns the operator session."""
    from routers.auth import _record_failure, _throttled

    try:
        claim = operators.read_challenge(body.challenge)
    except operators.OperatorError as exc:
        raise HTTPException(status_code=401, detail="Sign in again: that step expired.") from exc
    email = claim["sub"]
    if _throttled(_throttle_key(email), _ip(request)):
        raise HTTPException(status_code=429, detail="Too many attempts. Wait 15 minutes and try again.")
    op = operators.get(email)
    if not op or op.get("active") != operators.ACTIVE or not op.get("totp_secret"):
        raise HTTPException(status_code=401, detail="Sign in again.")
    step = totp.verify(operators.unseal(op["totp_secret"]), body.code, op.get("totp_last_step"))
    if step is None:
        _record_failure(_throttle_key(email), _ip(request))
        raise HTTPException(status_code=401, detail="That code isn't right. Use the current code from your authenticator app.")
    with cursor() as cur:
        cur.execute(
            """UPDATE operators SET totp_enabled = 1, totp_last_step = ?, last_login_at = datetime('now')
               WHERE email = ?""",
            (step, email),
        )
        cur.execute("DELETE FROM login_failures WHERE email = ?", (_throttle_key(email),))
    operators.record(audit.OPERATOR_LOGIN, email, enrolled=bool(claim.get("enroll")))
    session = operators.issue_session(email, op.get("session_version") or 0)
    return {**session, "operator": operators.public(operators.get(email))}


class AcceptBody(BaseModel):
    token: str = Field(max_length=200)
    password: str = Field(min_length=8, max_length=200)
    name: str | None = Field(None, max_length=80)


@router.post("/auth/accept-invite")
def accept_invite(body: AcceptBody):
    """A new operator sets their password from the invite link. They enrol an
    authenticator on their first sign-in."""
    from routers.auth import token_hash

    with cursor() as cur:
        cur.execute(
            "SELECT email FROM operator_invites WHERE token = ? AND expires_at > ?",
            (token_hash(body.token), int(time.time())),
        )
        row = cur.fetchone()
        if not row:
            raise HTTPException(status_code=400, detail="This invite link has expired or was already used.")
        cur.execute(
            """UPDATE operators SET hashed_password = ?, active = ?, name = COALESCE(?, name),
                   totp_enabled = 0, totp_secret = NULL, session_version = session_version + 1
               WHERE email = ? AND active = ?""",
            (hash_password(body.password), operators.ACTIVE, (body.name or "").strip() or None,
             row["email"], operators.INVITED),
        )
        cur.execute("DELETE FROM operator_invites WHERE email = ?", (row["email"],))
    return {"email": row["email"], "status": "active"}


@router.get("/me")
def me(request: Request):
    return operators.public(operators.current(request))


# ── Institutions ─────────────────────────────────────────────────────────────

def _institution_stats(institution_id: str | None = None) -> list[dict]:
    where, args = ("WHERE i.institution_id = ?", [institution_id]) if institution_id else ("", [])
    with cursor() as cur:
        cur.execute(
            f"""SELECT i.institution_id, i.name, i.type, i.contact_email, i.mode,
                       COALESCE(i.status, 'active') AS status, i.created_at, i.suspended_reason,
                       (SELECT COUNT(*) FROM customers c WHERE c.institution_id = i.institution_id) AS customers,
                       (SELECT COUNT(*) FROM customers c WHERE c.institution_id = i.institution_id AND c.kind = 'real') AS real_customers,
                       (SELECT COUNT(*) FROM transaction_history h WHERE h.institution_id = i.institution_id) AS history,
                       (SELECT COUNT(*) FROM transactions t WHERE t.institution_id = i.institution_id
                          AND t.created_at >= datetime('now', '-30 days')) AS decisions_30d,
                       (SELECT MAX(t.created_at) FROM transactions t WHERE t.institution_id = i.institution_id) AS last_decision,
                       (SELECT COUNT(*) FROM admins a WHERE a.institution_id = i.institution_id AND COALESCE(a.active, 1) = 1) AS members,
                       (SELECT COUNT(*) FROM admins a WHERE a.institution_id = i.institution_id AND a.active = 2) AS invites_pending,
                       (SELECT COUNT(*) FROM admins a WHERE a.institution_id = i.institution_id AND a.active = 1
                          AND COALESCE(a.role, 'owner') = 'owner') AS owners
                FROM institutions i {where} ORDER BY i.created_at DESC""",
            args,
        )
        rows = [row_to_dict(r) for r in cur.fetchall()]
    for r in rows:
        # How far along setup is, from the same checklist the bank sees.
        ready = onboarding.checklist(r["institution_id"])
        r["setup_done"], r["setup_total"] = ready["done"], ready["total"]
        r["ready_to_go_live"] = ready["ready_to_go_live"]
    return rows


@router.get("/institutions")
def institutions(request: Request, q: str | None = Query(None, max_length=80)):
    operators.require(request, "support")
    rows = _institution_stats()
    if q:
        needle = q.strip().lower()
        rows = [r for r in rows if needle in (r["name"] or "").lower() or needle in r["institution_id"]]
    return {"institutions": rows, "total": len(rows)}


def _needs_attention(row: dict) -> str | None:
    """Why an operator should look at this institution, if they should."""
    if row["status"] == "suspended":
        return "Suspended"
    if not row["owners"]:
        return "Owner hasn't accepted the invite" if row["invites_pending"] else "No owner"
    if row["mode"] == "sandbox" and row["ready_to_go_live"]:
        return "Ready to go live"
    created = row.get("created_at") or ""
    if row["mode"] == "sandbox" and created and created < _days_ago(14) and row["setup_done"] * 2 < row["setup_total"]:
        return "Setup stalled for 2+ weeks"
    return None


def _days_ago(days: int) -> str:
    from datetime import datetime, timedelta, timezone

    return (datetime.now(timezone.utc) - timedelta(days=days)).strftime("%Y-%m-%d %H:%M:%S")


@router.get("/overview")
def overview(request: Request):
    """The platform at a glance: institutions by stage, activity, what needs attention."""
    operators.require(request, "support")
    from core.db import loads
    from services import assistant_controls as controls

    rows = _institution_stats()
    with cursor() as cur:
        cur.execute(
            """SELECT date(created_at) AS day, COUNT(*) AS n,
                      SUM(action_taken = 'BLOCK') AS blocked, SUM(action_taken = 'FLAG') AS flagged
               FROM transactions WHERE created_at >= datetime('now', '-14 days')
               GROUP BY date(created_at) ORDER BY day"""
        )
        decisions = [row_to_dict(r) for r in cur.fetchall()]
        marks = ",".join("?" * len(PLATFORM_EVENTS))
        cur.execute(
            f"""SELECT id, institution_id, event_type, payload, created_at FROM audit_log
                WHERE event_type IN ({marks}) ORDER BY id DESC LIMIT 8""",
            PLATFORM_EVENTS,
        )
        events = [row_to_dict(r) for r in cur.fetchall()]
        cur.execute("SELECT COUNT(*) AS n FROM operators WHERE COALESCE(active, 1) = 1")
        team = cur.fetchone()["n"]
        # Attempts to reach another bank's data, the clearest sign of probing.
        cur.execute(
            """SELECT SUM(created_at >= datetime('now', '-1 day')) AS day, COUNT(*) AS week
               FROM audit_log WHERE event_type = ? AND created_at >= datetime('now', '-7 days')""",
            (audit.ACCESS_DENIED,),
        )
        denied = cur.fetchone()
    for e in events:
        e["payload"] = loads(e.get("payload"), {}) or {}

    attention = [
        {"institution_id": r["institution_id"], "name": r["name"], "reason": reason,
         "setup_done": r["setup_done"], "setup_total": r["setup_total"]}
        for r in rows if (reason := _needs_attention(r))
    ]
    stages = {
        "setting_up": sum(1 for r in rows if r["mode"] == "sandbox" and not r["ready_to_go_live"] and r["status"] != "suspended"),
        "ready": sum(1 for r in rows if r["mode"] == "sandbox" and r["ready_to_go_live"] and r["status"] != "suspended"),
        "live": sum(1 for r in rows if r["mode"] == "live" and r["status"] != "suspended"),
        "suspended": sum(1 for r in rows if r["status"] == "suspended"),
    }
    ai = controls.usage(7)
    return {
        "institutions": len(rows),
        "stages": stages,
        "customers": sum(r["customers"] for r in rows),
        "real_customers": sum(r["real_customers"] for r in rows),
        "decisions_30d": sum(r["decisions_30d"] for r in rows),
        "decisions_by_day": decisions,
        "operators": team,
        "attention": attention,
        "recent_events": events,
        "assistant": {"today": ai["today"], "week": ai["totals"]},
        "security": {"access_denied_24h": int(denied["day"] or 0), "access_denied_7d": int(denied["week"] or 0)},
        "newest": [
            {"institution_id": r["institution_id"], "name": r["name"], "created_at": r["created_at"],
             "setup_done": r["setup_done"], "setup_total": r["setup_total"], "mode": r["mode"], "status": r["status"],
             "ready_to_go_live": r["ready_to_go_live"]}
            for r in rows[:5]
        ],
    }


class NewInstitution(BaseModel):
    name: str = Field(min_length=2, max_length=80)
    type: str | None = Field(None, max_length=60)
    owner_email: str = Field(max_length=200)
    owner_name: str | None = Field(None, max_length=80)


@router.post("/institutions", status_code=201)
def provision(body: NewInstitution, request: Request, background: BackgroundTasks):
    """Create an empty institution in sandbox mode and invite its first owner.

    Nothing else is created: no customers, no history, no API key. The owner
    sets those up in their own console. There is no temporary password and
    no key in any email; the owner chooses their password from a one-time link.
    """
    from routers.team import issue_invite

    op = operators.require(request, "platform_admin")
    name = " ".join(body.name.split())
    institution_id = slugify_institution(name)
    if len(institution_id) < 2:
        raise HTTPException(status_code=400, detail="Use a name with at least two letters or digits.")
    with cursor() as cur:
        cur.execute(
            """SELECT 1 FROM institutions WHERE institution_id = ?
               UNION SELECT 1 FROM institution_aliases WHERE alias = ?
               UNION SELECT 1 FROM institution_branding WHERE slug = ?""",
            (institution_id, institution_id, institution_id),
        )
        if cur.fetchone():
            raise HTTPException(status_code=409, detail=f"An institution called {institution_id} already exists.")
    owner_email = body.owner_email.strip().lower()
    if not _EMAIL_RE.match(owner_email):
        raise HTTPException(status_code=422, detail="Enter the owner's email address.")

    register_institution(institution_id, name, owner_email, (body.type or "Financial Institution").strip())
    invite = issue_invite(institution_id, owner_email, "owner", body.owner_name, f"Fable ({op['email']})", background)
    operators.record(audit.INSTITUTION_PROVISIONED, op["email"], institution_id, name=name, owner=owner_email)
    return {"institution": _institution_stats(institution_id)[0], "owner_invite": invite}


@router.get("/institutions/{institution_id}")
def institution(institution_id: str, request: Request):
    operators.require(request, "support")
    rows = _institution_stats(institution_id)
    if not rows:
        raise HTTPException(status_code=404, detail="Institution not found.")
    with cursor() as cur:
        cur.execute(
            """SELECT email, name, COALESCE(role, 'owner') AS role, COALESCE(active, 1) AS active, created_at
               FROM admins WHERE institution_id = ? AND COALESCE(active, 1) != 0 ORDER BY created_at""",
            (institution_id,),
        )
        members = [
            {**row_to_dict(r), "status": "invited" if r["active"] == 2 else "active"} for r in cur.fetchall()
        ]
        cur.execute(
            """SELECT event_type, payload, created_at FROM audit_log
               WHERE institution_id = ? ORDER BY id DESC LIMIT 25""",
            (institution_id,),
        )
        events = [row_to_dict(r) for r in cur.fetchall()]
    from core.db import loads

    for e in events:
        e["payload"] = loads(e.get("payload"), {}) or {}
    from services import assistant_controls as controls

    return {
        "institution": rows[0],
        "onboarding": onboarding.checklist(institution_id),
        "members": [{k: v for k, v in m.items() if k != "active"} for m in members],
        "recent_events": events,
        "assistant": {
            "override": controls.bank_override(institution_id),
            "usage": controls.institution_usage(institution_id),
            "platform": {k: controls.settings()[k] for k in ("ai_enabled", "institution_daily_answers")},
        },
    }


class AssistantOverride(BaseModel):
    # None means "follow the platform setting".
    enabled: bool | None = None
    daily_answers: int | None = Field(None, ge=0, le=100000)


@router.put("/institutions/{institution_id}/assistant")
def institution_assistant(institution_id: str, body: AssistantOverride, request: Request):
    """Turn Ask Fable's AI answers on or off for one bank, or give it its own daily budget."""
    from services import assistant_controls as controls

    op = operators.require(request, "platform_admin")
    if not _institution_stats(institution_id):
        raise HTTPException(status_code=404, detail="Institution not found.")
    out = controls.set_bank_override(institution_id, body.enabled, body.daily_answers, op["email"])
    operators.record(audit.INSTITUTION_ASSISTANT_CHANGED, op["email"], institution_id,
                     enabled=body.enabled, daily_answers=body.daily_answers)
    return out


# ── Ask Fable, platform-wide ─────────────────────────────────────────────────

@router.get("/assistant")
def assistant_settings(request: Request, days: int = Query(30, ge=1, le=90)):
    """Ask Fable's limits, which AI providers are configured, and usage."""
    from services import assistant_controls as controls

    operators.require(request, "support")
    return {
        "settings": controls.settings(),
        "fields": {k: {"default": d, "min": lo, "max": hi, "help": h} for k, (d, lo, hi, h) in controls.SETTINGS.items()},
        "providers": {
            "openai": {"configured": bool(config.OPENAI_API_KEY), "model": config.OPENAI_MODEL},
            "anthropic": {"configured": bool(config.ANTHROPIC_API_KEY), "model": config.ANTHROPIC_MODEL},
        },
        "usage": controls.usage(days),
    }


@router.put("/assistant")
def update_assistant_settings(body: dict, request: Request):
    """Change Ask Fable's limits. Platform owners only."""
    from services import assistant_controls as controls

    op = operators.require(request, "platform_owner")
    before = controls.settings()
    after = controls.update(body, op["email"])
    changed = {k: {"from": before[k], "to": after[k]} for k in after if before[k] != after[k]}
    if changed:
        controls.reset_runtime()
        operators.record(audit.ASSISTANT_SETTINGS_CHANGED, op["email"], changes=changed)
    return {"settings": after}


class SuspendBody(BaseModel):
    reason: str = Field(min_length=3, max_length=300)


@router.post("/institutions/{institution_id}/suspend")
def suspend(institution_id: str, body: SuspendBody, request: Request):
    """Cut off an institution's console, API keys and sandbox at once, for
    example on a security incident or an unpaid account. Nothing is deleted."""
    op = operators.require(request, "platform_admin")
    if not get_institution(institution_id):
        raise HTTPException(status_code=404, detail="Institution not found.")
    with cursor() as cur:
        cur.execute(
            """UPDATE institutions SET status = 'suspended', suspended_reason = ?, suspended_at = datetime('now')
               WHERE institution_id = ?""",
            (body.reason.strip(), institution_id),
        )
    operators.record(audit.INSTITUTION_SUSPENDED, op["email"], institution_id, reason=body.reason.strip())
    return _institution_stats(institution_id)[0]


@router.post("/institutions/{institution_id}/reactivate")
def reactivate(institution_id: str, request: Request):
    op = operators.require(request, "platform_admin")
    if not get_institution(institution_id):
        raise HTTPException(status_code=404, detail="Institution not found.")
    with cursor() as cur:
        cur.execute(
            """UPDATE institutions SET status = 'active', suspended_reason = NULL, suspended_at = NULL
               WHERE institution_id = ?""",
            (institution_id,),
        )
    operators.record(audit.INSTITUTION_REACTIVATED, op["email"], institution_id)
    return _institution_stats(institution_id)[0]


class OwnerInvite(BaseModel):
    email: str = Field(max_length=200)
    name: str | None = Field(None, max_length=80)


@router.post("/institutions/{institution_id}/owner-invite")
def invite_owner(institution_id: str, body: OwnerInvite, request: Request, background: BackgroundTasks):
    """Send (or re-send) an owner invite, for example when the first owner's
    link expired or the institution's owner has changed."""
    from routers.team import issue_invite

    op = operators.require(request, "platform_admin")
    if not get_institution(institution_id):
        raise HTTPException(status_code=404, detail="Institution not found.")
    invite = issue_invite(institution_id, body.email, "owner", body.name, f"Fable ({op['email']})", background)
    operators.record(audit.OWNER_INVITED, op["email"], institution_id, owner=invite["email"])
    return invite


class DestructiveBody(BaseModel):
    # The institution's id, typed by the operator, and why. Both are recorded.
    confirm: str
    reason: str = Field(min_length=5, max_length=300)


def _confirmed(institution_id: str, body: DestructiveBody) -> None:
    if body.confirm.strip() != institution_id:
        raise HTTPException(status_code=400, detail=f"Type {institution_id} to confirm.")


@router.get("/institutions/{institution_id}/export.zip")
def export(institution_id: str, request: Request):
    """Everything about the institution's customers, as CSVs, for the bank to
    keep before its data is cleared or the institution is deleted."""
    from fastapi.responses import Response

    from services import data_admin

    op = operators.require(request, "platform_admin")
    if not get_institution(institution_id):
        raise HTTPException(status_code=404, detail="Institution not found.")
    operators.record("institution.exported", op["email"], institution_id)
    return Response(
        data_admin.export_institution(institution_id),
        media_type="application/zip",
        headers={"Content-Disposition": f'attachment; filename="fable-{institution_id}-export.zip"'},
    )


@router.post("/institutions/{institution_id}/clear-data")
def clear_data(institution_id: str, body: DestructiveBody, request: Request):
    """Remove every customer and their activity, keeping the institution, its
    team, keys, policy, webhooks and audit trail. Platform owners only."""
    from services import data_admin

    op = operators.require(request, "platform_owner")
    _confirmed(institution_id, body)
    try:
        return data_admin.clear_institution(institution_id, op["email"], body.reason.strip())
    except data_admin.DataAdminError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc


@router.post("/institutions/{institution_id}/delete")
def delete(institution_id: str, body: DestructiveBody, request: Request):
    """Offboard a suspended institution: everything is removed except its audit
    trail, which records the deletion. Platform owners only."""
    from services import data_admin

    op = operators.require(request, "platform_owner")
    _confirmed(institution_id, body)
    try:
        return data_admin.delete_institution(institution_id, op["email"], body.reason.strip())
    except data_admin.DataAdminError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc


# ── Operator team ────────────────────────────────────────────────────────────

@router.get("/team")
def team(request: Request):
    operators.require(request, "support")
    with cursor() as cur:
        cur.execute("SELECT * FROM operators WHERE active != ? ORDER BY created_at", (operators.REMOVED,))
        return {"operators": [operators.public(row_to_dict(r)) for r in cur.fetchall()]}


class NewOperator(BaseModel):
    email: str = Field(max_length=200)
    name: str | None = Field(None, max_length=80)
    role: str = "support"


def _send_operator_invite(email: str, inviter: str, link: str) -> None:
    if not config.SMTP_USERNAME or not config.SMTP_PASSWORD:
        return
    msg = EmailMessage()
    msg["Subject"] = "You've been invited to operate Fable"
    msg["From"] = config.SMTP_FROM
    msg["To"] = email
    msg.set_content(
        f"{inviter} invited you to the Fable operator platform.\n\n"
        f"Set your password to accept: {link}\n\n"
        "You will set up an authenticator app the first time you sign in. This link expires in 3 days."
    )
    try:
        with smtplib.SMTP(config.SMTP_SERVER, config.SMTP_PORT, timeout=10) as server:
            server.starttls()
            server.login(config.SMTP_USERNAME, config.SMTP_PASSWORD)
            server.send_message(msg)
    except Exception as exc:  # noqa: BLE001 - the invite stays valid; it can be re-sent
        logger.warning("Failed to send operator invite to %s: %s", email, exc)


def invite_operator(email: str, name: str | None, role: str, invited_by: str) -> tuple[str, str]:
    """Create an invited operator and return (email, the one-time link)."""
    from routers.auth import token_hash

    email = email.strip().lower()
    if not _EMAIL_RE.match(email):
        raise HTTPException(status_code=422, detail="Enter a valid email address.")
    if role not in operators.ROLES:
        raise HTTPException(status_code=422, detail="Role must be platform_owner, platform_admin or support.")
    existing = operators.get(email)
    if existing and existing.get("active") == operators.ACTIVE:
        raise HTTPException(status_code=409, detail="That person is already an operator.")
    token = secrets.token_urlsafe(32)
    with cursor() as cur:
        cur.execute(
            """INSERT INTO operators (email, name, role, hashed_password, active, totp_enabled, totp_secret)
               VALUES (?, ?, ?, ?, ?, 0, NULL)
               ON CONFLICT(email) DO UPDATE SET name = excluded.name, role = excluded.role,
                   hashed_password = excluded.hashed_password, active = excluded.active,
                   totp_enabled = 0, totp_secret = NULL""",
            (email, (name or "").strip() or None, role, hash_password(secrets.token_urlsafe(24)), operators.INVITED),
        )
        cur.execute("DELETE FROM operator_invites WHERE email = ?", (email,))
        cur.execute(
            "INSERT INTO operator_invites (token, email, expires_at) VALUES (?, ?, ?)",
            (token_hash(token), email, int(time.time()) + operators.INVITE_TTL_SECONDS),
        )
    operators.record(audit.OPERATOR_INVITED, invited_by, operator_email=email, role=role)
    return email, f"{config.FRONTEND_URL.rstrip('/')}/operator/accept?token={token}"


@router.post("/team", status_code=201)
def add_operator(body: NewOperator, request: Request, background: BackgroundTasks):
    op = operators.require(request, "platform_owner")
    email, link = invite_operator(body.email, body.name, body.role, op["email"])
    emailed = bool(config.SMTP_USERNAME and config.SMTP_PASSWORD)
    background.add_task(_send_operator_invite, email, op["email"], link)
    return {**operators.public(operators.get(email)), "emailed": emailed, "invite_link": None if emailed else link}


def _owners_left(excluding: str) -> int:
    with cursor() as cur:
        cur.execute(
            "SELECT COUNT(*) FROM operators WHERE role = 'platform_owner' AND active = ? AND email != ?",
            (operators.ACTIVE, excluding),
        )
        return cur.fetchone()[0]


class OperatorRole(BaseModel):
    role: str


@router.patch("/team/{email}")
def change_operator(email: str, body: OperatorRole, request: Request):
    op = operators.require(request, "platform_owner")
    target = operators.get(email)
    if not target or target.get("active") == operators.REMOVED:
        raise HTTPException(status_code=404, detail="No operator with that email.")
    if body.role not in operators.ROLES:
        raise HTTPException(status_code=422, detail="Unknown role.")
    if target["role"] == "platform_owner" and body.role != "platform_owner" and not _owners_left(target["email"]):
        raise HTTPException(status_code=409, detail="Fable needs at least one platform owner.")
    with cursor() as cur:
        cur.execute(
            "UPDATE operators SET role = ?, session_version = session_version + 1 WHERE email = ?",
            (body.role, target["email"]),
        )
    operators.record(audit.OPERATOR_CHANGED, op["email"], operator_email=target["email"], role=body.role)
    return operators.public(operators.get(target["email"]))


@router.delete("/team/{email}")
def remove_operator(email: str, request: Request):
    op = operators.require(request, "platform_owner")
    target = operators.get(email)
    if not target or target.get("active") == operators.REMOVED:
        raise HTTPException(status_code=404, detail="No operator with that email.")
    if target["email"] == op["email"]:
        raise HTTPException(status_code=409, detail="You can't remove yourself.")
    if target["role"] == "platform_owner" and not _owners_left(target["email"]):
        raise HTTPException(status_code=409, detail="Fable needs at least one platform owner.")
    with cursor() as cur:
        cur.execute(
            "UPDATE operators SET active = ?, session_version = session_version + 1 WHERE email = ?",
            (operators.REMOVED, target["email"]),
        )
        cur.execute("DELETE FROM operator_invites WHERE email = ?", (target["email"],))
    operators.record(audit.OPERATOR_CHANGED, op["email"], operator_email=target["email"], removed=True)
    return {"email": target["email"], "status": "removed"}


# ── Audit ────────────────────────────────────────────────────────────────────

PLATFORM_EVENTS = (
    audit.INSTITUTION_PROVISIONED, audit.INSTITUTION_SUSPENDED, audit.INSTITUTION_REACTIVATED,
    audit.OWNER_INVITED, audit.OPERATOR_LOGIN, audit.OPERATOR_INVITED, audit.OPERATOR_CHANGED,
    "institution.exported", "institution.data_cleared", "institution.deleted",
    audit.ASSISTANT_SETTINGS_CHANGED, audit.INSTITUTION_ASSISTANT_CHANGED, "operator.audit_exported",
)


# Which events each view of the audit log shows. "operators" is every action a
# Fable operator took; "security" is what a platform team watches for; "all" is
# every event from every institution.
SECURITY_EVENTS = (audit.ACCESS_DENIED, audit.STEPUP_FAILED, "operator.secret_stepup_failed",
                   "operator.secret_locked", audit.INSTITUTION_SUSPENDED, "institution.deleted",
                   "institution.data_cleared", audit.KEY_ROTATED, audit.PASSWORD_CHANGED)
AUDIT_SCOPES = ("operators", "all", "security")


def _audit_where(scope: str, institution: str | None, event_type: str | None, q: str | None,
                 before: int | None, since: str | None) -> tuple[str, list]:
    clauses, args = [], []
    if scope == "operators":
        marks = ",".join("?" * len(PLATFORM_EVENTS))
        clauses.append(f"(event_type IN ({marks}) OR json_extract(payload, '$.operator') IS NOT NULL)")
        args += list(PLATFORM_EVENTS)
    elif scope == "security":
        marks = ",".join("?" * len(SECURITY_EVENTS))
        clauses.append(f"event_type IN ({marks})")
        args += list(SECURITY_EVENTS)
    if institution:
        clauses.append("institution_id = ?")
        args.append(institution)
    if event_type:
        clauses.append("(event_type = ? OR event_type LIKE ?)")
        args += [event_type, f"{event_type}.%"]
    if q:
        clauses.append("(payload LIKE ? OR user_id LIKE ? OR institution_id LIKE ?)")
        args += [f"%{q}%"] * 3
    if before:
        clauses.append("id < ?")
        args.append(before)
    if since:
        clauses.append("created_at >= ?")
        args.append(since)
    return (" WHERE " + " AND ".join(clauses)) if clauses else "", args


def _actor(row: dict) -> str:
    p = row["payload"]
    return str(p.get("operator") or p.get("by") or p.get("actor") or p.get("email") or row.get("user_id") or "System")


@router.get("/audit")
def platform_audit(
    request: Request,
    scope: str = Query("operators"),
    institution: str | None = Query(None, max_length=80),
    type: str | None = Query(None, max_length=60),
    q: str | None = Query(None, max_length=80),
    before: int | None = Query(None, ge=1),
    since: str | None = Query(None, max_length=20),
    limit: int = Query(50, ge=1, le=200),
):
    """The audit log, newest first, a page at a time.

    Support sees what operators did. Every institution's events, and the
    security view, need a platform admin: they include bank staff and customer
    references, so they are kept to the people who act on them.
    """
    from core.db import loads

    if scope not in AUDIT_SCOPES:
        raise HTTPException(status_code=400, detail="scope must be operators, all or security.")
    operators.require(request, "support" if scope == "operators" else "platform_admin")
    where, args = _audit_where(scope, institution, type, (q or "").strip() or None, before, since)
    with cursor() as cur:
        cur.execute(
            f"""SELECT id, user_id, institution_id, event_type, payload, created_at FROM audit_log{where}
                ORDER BY id DESC LIMIT ?""",
            (*args, limit + 1),
        )
        rows = [row_to_dict(r) for r in cur.fetchall()]
        # What kinds of event this view holds, for the filter. Counted over the
        # whole view, not just this page.
        base_where, base_args = _audit_where(scope, institution, None, None, None, None)
        cur.execute(
            f"""SELECT event_type, COUNT(*) AS n FROM audit_log{base_where}
                GROUP BY event_type ORDER BY n DESC LIMIT 60""",
            base_args,
        )
        types = [row_to_dict(r) for r in cur.fetchall()]
    more = len(rows) > limit
    rows = rows[:limit]
    for r in rows:
        r["payload"] = loads(r.get("payload"), {}) or {}
        r["actor"] = _actor(r)
    return {"events": rows, "next_before": rows[-1]["id"] if more and rows else None, "types": types}


@router.get("/audit/export.csv")
def export_audit(
    request: Request,
    scope: str = Query("operators"),
    institution: str | None = Query(None, max_length=80),
    type: str | None = Query(None, max_length=60),
    q: str | None = Query(None, max_length=80),
    since: str | None = Query(None, max_length=20),
):
    """The same view as CSV (up to 20,000 rows). The export itself is audited."""
    import csv
    import io
    import json

    from fastapi.responses import Response

    from core.db import loads

    if scope not in AUDIT_SCOPES:
        raise HTTPException(status_code=400, detail="scope must be operators, all or security.")
    op = operators.require(request, "support" if scope == "operators" else "platform_admin")
    where, args = _audit_where(scope, institution, type, (q or "").strip() or None, None, since)
    with cursor() as cur:
        cur.execute(
            f"""SELECT id, user_id, institution_id, event_type, payload, created_at FROM audit_log{where}
                ORDER BY id DESC LIMIT 20000""",
            args,
        )
        rows = [row_to_dict(r) for r in cur.fetchall()]
    buf = io.StringIO()
    w = csv.writer(buf)
    w.writerow(["id", "time_utc", "event", "institution", "actor", "details"])
    for r in rows:
        r["payload"] = loads(r.get("payload"), {}) or {}
        cells = [r["id"], r["created_at"], r["event_type"], r["institution_id"] or "", _actor(r),
                 json.dumps(r["payload"], ensure_ascii=False, sort_keys=True)]
        # A cell a spreadsheet would run as a formula is neutralised.
        w.writerow([f"'{c}" if isinstance(c, str) and c[:1] in ("=", "+", "-", "@") else c for c in cells])
    operators.record("operator.audit_exported", op["email"], institution, scope=scope, rows=len(rows))
    return Response(buf.getvalue(), media_type="text/csv",
                    headers={"Content-Disposition": f'attachment; filename="fable-audit-{scope}.csv"',
                             "Cache-Control": "no-store"})
