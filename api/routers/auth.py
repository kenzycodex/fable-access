import hashlib

from fastapi import APIRouter, HTTPException, BackgroundTasks, Request
from pydantic import BaseModel
from db import get_conn, cursor
from utils import hash_password, needs_rehash, verify_password
import logging
import secrets
import time
import config
import sessions
from email.message import EmailMessage
import smtplib

router = APIRouter(prefix="/auth", tags=["auth"])
logger = logging.getLogger("fable.auth")

# admins.active: 1 can sign in, 0 removed by an owner, 2 invited and has not set
# a password yet. Only an invite token moves 2 to 1; a removed member cannot
# reactivate themselves through "forgot password".
ACTIVE, REMOVED, INVITED = 1, 0, 2
MIN_PASSWORD = 8

# Sign-in throttling. Five wrong passwords for one account, or thirty from one
# address, inside the window, and further attempts are refused until it passes.
# Stored in the database rather than in memory so it holds across workers and
# restarts.
LOGIN_WINDOW_SECONDS = 15 * 60
MAX_FAILURES_PER_ACCOUNT = 5
MAX_FAILURES_PER_IP = 30


def token_hash(token: str) -> str:
    """Reset and invite tokens are stored hashed, like API keys: a copy of the
    database must not hand anyone a working link."""
    return "sha256:" + hashlib.sha256(token.encode()).hexdigest()


def _client_ip(request: Request) -> str:
    return request.client.host if request.client else "unknown"


def _throttled(email: str, ip: str) -> bool:
    since = int(time.time()) - LOGIN_WINDOW_SECONDS
    with cursor() as c:
        c.execute("SELECT COUNT(*) AS n FROM login_failures WHERE email = ? AND at >= ?", (email, since))
        by_account = c.fetchone()["n"]
        c.execute("SELECT COUNT(*) AS n FROM login_failures WHERE ip = ? AND at >= ?", (ip, since))
        by_ip = c.fetchone()["n"]
    return by_account >= MAX_FAILURES_PER_ACCOUNT or by_ip >= MAX_FAILURES_PER_IP


def _record_failure(email: str, ip: str) -> None:
    now = int(time.time())
    with cursor() as c:
        c.execute("INSERT INTO login_failures (email, ip, at) VALUES (?, ?, ?)", (email, ip, now))
        c.execute("DELETE FROM login_failures WHERE at < ?", (now - 24 * 3600,))

class LoginRequest(BaseModel):
    email: str
    password: str

# Verified against a throwaway hash when the account does not exist, so a
# missing email costs the same time as a wrong password. Without this, login
# returned instantly for unknown addresses and only paid the hashing cost for
# real ones, which enumerates accounts by stopwatch. Note the irony that
# /forgot-password below already defends against enumeration explicitly.
_DUMMY_HASH = hash_password(secrets.token_urlsafe(16))


@router.post("/login")
def login(req: LoginRequest, request: Request):
    attempt_email = req.email.strip().lower()
    ip = _client_ip(request)
    if _throttled(attempt_email, ip):
        raise HTTPException(
            status_code=429,
            detail="Too many sign-in attempts. Wait 15 minutes, or reset your password.",
            headers={"Retry-After": str(LOGIN_WINDOW_SECONDS)},
        )

    conn = get_conn()
    cur = conn.cursor()
    cur.execute(
        "SELECT email, hashed_password, institution_id, role, name, COALESCE(active, 1) AS active, "
        "COALESCE(session_version, 0) AS sv FROM admins WHERE lower(email) = lower(?)",
        (req.email.strip(),),
    )
    row = cur.fetchone()

    if not row:
        verify_password(req.password, _DUMMY_HASH)  # equalise timing
        _record_failure(attempt_email, ip)
        raise HTTPException(status_code=401, detail="Invalid credentials")

    if not verify_password(req.password, row["hashed_password"]):
        _record_failure(attempt_email, ip)
        raise HTTPException(status_code=401, detail="Invalid credentials")

    # Checked after the password, so a removed account is not distinguishable
    # from a wrong password to someone guessing.
    if row["active"] != ACTIVE:
        raise HTTPException(status_code=401, detail="Invalid credentials")

    with cursor() as c:
        c.execute("DELETE FROM login_failures WHERE email = ?", (attempt_email,))

    # The address as stored, so the session and audit name the same account
    # however the email was typed at sign-in.
    email = row["email"]

    # Upgrade legacy single-round SHA-256 hashes now that we hold the plaintext
    # and know it is correct. Nobody is locked out by the algorithm change; they
    # are migrated on their next successful sign-in.
    if needs_rehash(row["hashed_password"]):
        with cursor() as c:
            c.execute(
                "UPDATE admins SET hashed_password = ? WHERE email = ?",
                (hash_password(req.password), email),
            )

    import audit
    audit.record(audit.ADMIN_LOGIN, email, institution_id=row["institution_id"])

    session = sessions.issue(email, row["institution_id"], row["sv"])
    return {
        "success": True,
        "institution_id": row["institution_id"],
        "email": email,
        "role": row["role"] or "owner",
        "name": row["name"],
        # The console presents this on every API call. It replaces the previous
        # arrangement, where login returned no credential at all and the client
        # invented one by setting a cookie equal to "1".
        **session,
    }


class ForgotPasswordRequest(BaseModel):
    email: str

def send_reset_email(email: str, token: str):
    if not config.SMTP_USERNAME or not config.SMTP_PASSWORD:
        logger.info("Skipping reset email: SMTP is not configured.")
        return
    reset_url = f"{config.FRONTEND_URL.rstrip('/')}/dashboard/reset-password?token={token}"
    msg = EmailMessage()
    msg['Subject'] = "Reset your Fable Dashboard Password"
    msg['From'] = config.SMTP_FROM
    msg['To'] = email
    
    html_content = f"""
    <html>
      <body style="font-family: Arial, sans-serif; color: #333;">
        <h2 style="color: #7C3AED;">Password Reset</h2>
        <p>You requested to reset your password for the Fable Dashboard.</p>
        <p>Click the link below to set a new password:</p>
        <p><a href="{reset_url}" style="background: #7C3AED; color: white; padding: 10px 20px; text-decoration: none; border-radius: 4px; display: inline-block; margin-top: 10px;">Reset Password</a></p>
        <p style="margin-top: 30px; font-size: 12px; color: #888;">If you did not request this, please ignore this email.</p>
      </body>
    </html>
    """
    msg.set_content("Please view this email in an HTML compatible client.")
    msg.add_alternative(html_content, subtype='html')

    try:
        with smtplib.SMTP(config.SMTP_SERVER, config.SMTP_PORT) as server:
            server.starttls()
            server.login(config.SMTP_USERNAME, config.SMTP_PASSWORD)
            server.send_message(msg)
    except Exception as e:
        logger.warning("Failed to send reset email: %s", e)

@router.post("/forgot-password")
def forgot_password(req: ForgotPasswordRequest, bg_tasks: BackgroundTasks):
    conn = get_conn()
    cur = conn.cursor()
    cur.execute("SELECT email FROM admins WHERE email = ? AND COALESCE(active, 1) = 1", (req.email,))
    if not cur.fetchone():
        return {"success": True} # Always return success to prevent email enumeration
    
    token = secrets.token_urlsafe(32)
    expires_at = int(time.time()) + 3600 # 1 hour

    with cursor() as c:
        # One live link per account: asking again replaces the earlier one.
        c.execute("DELETE FROM password_resets WHERE email = ?", (req.email,))
        c.execute("INSERT INTO password_resets (token, email, expires_at) VALUES (?, ?, ?)", (token_hash(token), req.email, expires_at))

    bg_tasks.add_task(send_reset_email, req.email, token)
    return {"success": True}


class ResetPasswordRequest(BaseModel):
    token: str
    new_password: str

@router.post("/reset-password")
def reset_password(req: ResetPasswordRequest):
    conn = get_conn()
    cur = conn.cursor()
    cur.execute(
        "SELECT token, email, expires_at FROM password_resets WHERE token IN (?, ?)",
        (token_hash(req.token), req.token),
    )
    row = cur.fetchone()
    if not row:
        raise HTTPException(status_code=400, detail="Invalid or expired token")
    
    if int(time.time()) > row['expires_at']:
        raise HTTPException(status_code=400, detail="Token expired")
    if len(req.new_password) < MIN_PASSWORD:
        raise HTTPException(status_code=422, detail=f"Use at least {MIN_PASSWORD} characters.")

    cur.execute("SELECT COALESCE(active, 1) AS active FROM admins WHERE email = ?", (row['email'],))
    admin = cur.fetchone()
    if not admin or admin["active"] == REMOVED:
        raise HTTPException(status_code=400, detail="Invalid or expired token")

    hashed = hash_password(req.new_password)
    with cursor() as c:
        # Setting a password is how an invited member accepts the invite.
        # The new password also ends every existing session for the account.
        c.execute(
            "UPDATE admins SET hashed_password = ?, active = 1, session_version = COALESCE(session_version, 0) + 1 WHERE email = ?",
            (hashed, row['email']),
        )
        c.execute("DELETE FROM password_resets WHERE email = ?", (row['email'],))
        c.execute("DELETE FROM login_failures WHERE email = ?", (row['email'].lower(),))

    return {"success": True}


class ChangePasswordRequest(BaseModel):
    # Ignored, and kept only so older clients that still send it are accepted.
    # The account is the signed-in one: taking the email from the body meant
    # anyone holding an old password could change it with no session at all.
    email: str | None = None
    old_password: str
    new_password: str


def _session_email(request: Request) -> tuple[str, str]:
    try:
        payload = sessions.verify(sessions.extract_token(request))
    except sessions.SessionError:
        raise HTTPException(status_code=401, detail="Sign in to change your password.")
    return payload["sub"], payload["inst"]


@router.post("/change-password")
def change_password(req: ChangePasswordRequest, request: Request):
    email, institution_id = _session_email(request)
    conn = get_conn()
    cur = conn.cursor()
    cur.execute("SELECT hashed_password FROM admins WHERE email = ?", (email,))
    row = cur.fetchone()
    if not row or not verify_password(req.old_password, row['hashed_password']):
        raise HTTPException(status_code=401, detail="Invalid current password")
    if len(req.new_password) < MIN_PASSWORD:
        raise HTTPException(status_code=422, detail=f"Use at least {MIN_PASSWORD} characters.")

    hashed = hash_password(req.new_password)
    with cursor() as c:
        c.execute(
            "UPDATE admins SET hashed_password = ?, session_version = COALESCE(session_version, 0) + 1 WHERE email = ?",
            (hashed, email),
        )
        c.execute("SELECT session_version FROM admins WHERE email = ?", (email,))
        version = c.fetchone()["session_version"]

    import audit
    audit.record(audit.PASSWORD_CHANGED, email, institution_id=institution_id)
    # Every other session for this account has just ended. This one carries on
    # with a fresh token, so changing a password does not sign you out.
    return {"success": True, **sessions.issue(email, institution_id, version)}


@router.get("/me")
def me(request: Request):
    """Who the console is signed in as, with their current role."""
    from tenancy import console_identity

    who = console_identity(request)
    return {"email": who["email"], "name": who["name"], "role": who["role"], "institution_id": who["inst"]}
