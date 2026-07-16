from fastapi import APIRouter, HTTPException, BackgroundTasks
from pydantic import BaseModel
from db import get_conn, cursor
from utils import hash_password, verify_password
import secrets
import time
import config
from email.message import EmailMessage
import smtplib

router = APIRouter(prefix="/auth", tags=["auth"])

class LoginRequest(BaseModel):
    email: str
    password: str

@router.post("/login")
def login(req: LoginRequest):
    conn = get_conn()
    cur = conn.cursor()
    cur.execute("SELECT hashed_password, institution_id FROM admins WHERE email = ?", (req.email,))
    row = cur.fetchone()
    if not row:
        raise HTTPException(status_code=401, detail="Invalid credentials")
    
    if verify_password(req.password, row['hashed_password']):
        return {"success": True, "institution_id": row['institution_id']}
    else:
        raise HTTPException(status_code=401, detail="Invalid credentials")


class ForgotPasswordRequest(BaseModel):
    email: str

def send_reset_email(email: str, token: str):
    if not config.SMTP_USERNAME or not config.SMTP_PASSWORD:
        print(f"Skipping reset email: SMTP not configured.")
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
        print(f"Failed to send reset email: {e}")

@router.post("/forgot-password")
def forgot_password(req: ForgotPasswordRequest, bg_tasks: BackgroundTasks):
    conn = get_conn()
    cur = conn.cursor()
    cur.execute("SELECT email FROM admins WHERE email = ?", (req.email,))
    if not cur.fetchone():
        return {"success": True} # Always return success to prevent email enumeration
    
    token = secrets.token_urlsafe(32)
    expires_at = int(time.time()) + 3600 # 1 hour
    
    with cursor() as c:
        c.execute("INSERT OR REPLACE INTO password_resets (token, email, expires_at) VALUES (?, ?, ?)", (token, req.email, expires_at))
        
    bg_tasks.add_task(send_reset_email, req.email, token)
    return {"success": True}


class ResetPasswordRequest(BaseModel):
    token: str
    new_password: str

@router.post("/reset-password")
def reset_password(req: ResetPasswordRequest):
    conn = get_conn()
    cur = conn.cursor()
    cur.execute("SELECT email, expires_at FROM password_resets WHERE token = ?", (req.token,))
    row = cur.fetchone()
    if not row:
        raise HTTPException(status_code=400, detail="Invalid or expired token")
    
    if int(time.time()) > row['expires_at']:
        raise HTTPException(status_code=400, detail="Token expired")
        
    hashed = hash_password(req.new_password)
    with cursor() as c:
        c.execute("UPDATE admins SET hashed_password = ? WHERE email = ?", (hashed, row['email']))
        c.execute("DELETE FROM password_resets WHERE token = ?", (req.token,))
        
    return {"success": True}


class ChangePasswordRequest(BaseModel):
    email: str
    old_password: str
    new_password: str

@router.post("/change-password")
def change_password(req: ChangePasswordRequest):
    conn = get_conn()
    cur = conn.cursor()
    cur.execute("SELECT hashed_password FROM admins WHERE email = ?", (req.email,))
    row = cur.fetchone()
    if not row or not verify_password(req.old_password, row['hashed_password']):
        raise HTTPException(status_code=401, detail="Invalid current password")
        
    hashed = hash_password(req.new_password)
    with cursor() as c:
        c.execute("UPDATE admins SET hashed_password = ? WHERE email = ?", (hashed, req.email))
        
    return {"success": True}
