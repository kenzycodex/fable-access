"""The people at an institution who use the console.

An owner invites a colleague by email with a role. The invite is a one-time
link to set a password; until it is used the member cannot sign in. Owners can
change roles and remove members. A removed member's sessions stop working on
their next request, because every console call re-reads their row.

Roles:
  owner    everything, including people, keys, webhooks and risk policy
  analyst  works the review queue and resets customer PINs; reads everything
  viewer   reads everything, changes nothing
"""
import logging
import re
import secrets
import smtplib
import time
from email.message import EmailMessage

from fastapi import APIRouter, BackgroundTasks, HTTPException, Request
from pydantic import BaseModel, Field

from core import config
from core.db import cursor, row_to_dict
from core.tenancy import ROLES, get_institution, require_role
from core.utils import hash_password
from routers.auth import ACTIVE, INVITED, REMOVED
from services import audit

router = APIRouter(prefix="/v1/team", tags=["team"])
logger = logging.getLogger("fable.team")

INVITE_TTL_SECONDS = 7 * 24 * 60 * 60
_EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")


def _status(active) -> str:
    return {ACTIVE: "active", INVITED: "invited", REMOVED: "removed"}.get(active if active is not None else ACTIVE, "active")


@router.get("")
def members(request: Request):
    who = require_role(request, "viewer")
    with cursor() as cur:
        cur.execute(
            """SELECT email, name, COALESCE(role, 'owner') AS role, COALESCE(active, 1) AS active, created_at
               FROM admins WHERE institution_id = ? ORDER BY created_at ASC""",
            (who["inst"],),
        )
        rows = [row_to_dict(r) for r in cur.fetchall()]
    return {
        "members": [
            {"email": r["email"], "name": r["name"], "role": r["role"],
             "status": _status(r["active"]), "created_at": r["created_at"],
             "you": r["email"] == who["email"]}
            for r in rows if r["active"] != REMOVED
        ],
        "you": {"email": who["email"], "role": who["role"]},
    }


def _invite_link(token: str) -> str:
    return f"{config.FRONTEND_URL.rstrip('/')}/dashboard/reset-password?token={token}&invite=1"


def _send_invite(email: str, inviter: str, institution_name: str, role: str, link: str) -> None:
    if not config.SMTP_USERNAME or not config.SMTP_PASSWORD:
        return
    msg = EmailMessage()
    msg["Subject"] = f"You've been invited to {institution_name} on Fable"
    msg["From"] = config.SMTP_FROM
    msg["To"] = email
    msg.set_content(
        f"{inviter} invited you to the {institution_name} console on Fable as {role}.\n\n"
        f"Set your password to accept: {link}\n\nThis link expires in 7 days."
    )
    try:
        with smtplib.SMTP(config.SMTP_SERVER, config.SMTP_PORT, timeout=10) as server:
            server.starttls()
            server.login(config.SMTP_USERNAME, config.SMTP_PASSWORD)
            server.send_message(msg)
    except Exception as exc:  # noqa: BLE001 - the invite still exists; the link can be re-sent
        logger.warning("Failed to send invite email to %s: %s", email, exc)


class InviteBody(BaseModel):
    email: str = Field(..., max_length=200)
    name: str | None = Field(None, max_length=80)
    role: str = "analyst"


@router.post("/invite")
def invite(body: InviteBody, request: Request, background: BackgroundTasks):
    who = require_role(request, "owner")
    email = body.email.strip().lower()
    if not _EMAIL_RE.match(email):
        raise HTTPException(status_code=422, detail="Enter a valid email address.")
    if body.role not in ROLES:
        raise HTTPException(status_code=422, detail="Role must be owner, analyst or viewer.")

    with cursor() as cur:
        cur.execute("SELECT institution_id, COALESCE(active, 1) AS active FROM admins WHERE email = ?", (email,))
        existing = cur.fetchone()
    if existing and existing["institution_id"] != who["inst"]:
        # The address belongs to another bank's console. Saying so would leak
        # who uses Fable, so this reads like any other conflict.
        raise HTTPException(status_code=409, detail="That email cannot be invited.")
    if existing and existing["active"] == ACTIVE:
        raise HTTPException(status_code=409, detail="That person is already on your team.")

    # A random password nobody knows, so the row is never usable until the
    # invite link sets a real one.
    placeholder = hash_password(secrets.token_urlsafe(24))
    name = (body.name or "").strip() or None
    with cursor() as cur:
        cur.execute(
            """INSERT INTO admins (email, institution_id, hashed_password, role, name, active)
               VALUES (?, ?, ?, ?, ?, ?)
               ON CONFLICT(email) DO UPDATE SET role = excluded.role, name = excluded.name,
                                                active = excluded.active, hashed_password = excluded.hashed_password""",
            (email, who["inst"], placeholder, body.role, name, INVITED),
        )
        token = secrets.token_urlsafe(32)
        cur.execute("DELETE FROM password_resets WHERE email = ?", (email,))
        from routers.auth import token_hash

        cur.execute(
            "INSERT INTO password_resets (token, email, expires_at) VALUES (?, ?, ?)",
            (token_hash(token), email, int(time.time()) + INVITE_TTL_SECONDS),
        )

    inst = get_institution(who["inst"]) or {}
    link = _invite_link(token)
    emailed = bool(config.SMTP_USERNAME and config.SMTP_PASSWORD)
    background.add_task(_send_invite, email, who["email"], inst.get("name", who["inst"]), body.role, link)
    audit.record(audit.TEAM_INVITED, None, institution_id=who["inst"], member=email, role=body.role, by=who["email"])
    return {
        "email": email,
        "role": body.role,
        "status": "invited",
        "emailed": emailed,
        # Without email delivery the owner has no other way to get the link to
        # their colleague, so it is returned to them. With email it is not.
        "invite_link": None if emailed else link,
    }


class RoleBody(BaseModel):
    role: str


def _member(inst: str, email: str) -> dict:
    with cursor() as cur:
        cur.execute(
            "SELECT email, COALESCE(role, 'owner') AS role, COALESCE(active, 1) AS active FROM admins WHERE email = ? AND institution_id = ?",
            (email, inst),
        )
        row = row_to_dict(cur.fetchone())
    if not row or row["active"] == REMOVED:
        raise HTTPException(status_code=404, detail="No team member with that email.")
    return row


def _owner_count(inst: str) -> int:
    with cursor() as cur:
        cur.execute(
            "SELECT COUNT(*) AS n FROM admins WHERE institution_id = ? AND COALESCE(role, 'owner') = 'owner' AND COALESCE(active, 1) = 1",
            (inst,),
        )
        return cur.fetchone()["n"]


@router.patch("/{email}")
def change_role(email: str, body: RoleBody, request: Request):
    who = require_role(request, "owner")
    email = email.strip().lower()
    if body.role not in ROLES:
        raise HTTPException(status_code=422, detail="Role must be owner, analyst or viewer.")
    member = _member(who["inst"], email)
    if member["role"] == "owner" and body.role != "owner" and _owner_count(who["inst"]) <= 1:
        raise HTTPException(status_code=409, detail="Your institution needs at least one owner.")
    with cursor() as cur:
        cur.execute("UPDATE admins SET role = ? WHERE email = ? AND institution_id = ?", (body.role, email, who["inst"]))
    audit.record(audit.TEAM_ROLE_CHANGED, None, institution_id=who["inst"], member=email,
                 role=body.role, previous=member["role"], by=who["email"])
    return {"email": email, "role": body.role}


@router.delete("/{email}")
def remove(email: str, request: Request):
    who = require_role(request, "owner")
    email = email.strip().lower()
    member = _member(who["inst"], email)
    if member["role"] == "owner" and _owner_count(who["inst"]) <= 1:
        raise HTTPException(status_code=409, detail="Your institution needs at least one owner.")
    with cursor() as cur:
        # Deactivated, not deleted, so the audit trail can still name them.
        cur.execute(
            "UPDATE admins SET active = ?, session_version = COALESCE(session_version, 0) + 1 WHERE email = ? AND institution_id = ?",
            (REMOVED, email, who["inst"]),
        )
        cur.execute("DELETE FROM password_resets WHERE email = ?", (email,))
    audit.record(audit.TEAM_REMOVED, None, institution_id=who["inst"], member=email, by=who["email"])
    return {"email": email, "status": "removed"}
