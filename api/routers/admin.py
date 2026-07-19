import smtplib
from email.message import EmailMessage
from fastapi import APIRouter, HTTPException, BackgroundTasks
from pydantic import BaseModel
import secrets
import string
import config
from db import cursor, slugify_institution
from tenancy import register_institution
from agents.copilot.demo_customers import seed_institution
from utils import hash_password

router = APIRouter(prefix="/admin", tags=["admin"])

class ProvisionRequest(BaseModel):
    institution_name: str
    admin_email: str

def generate_temp_password(length=12):
    alphabet = string.ascii_letters + string.digits + "!@#$%^&*"
    return "".join(secrets.choice(alphabet) for i in range(length))

def generate_api_key():
    return f"fable_live_{secrets.token_hex(16)}"

def send_provision_email(admin_email: str, institution_name: str, temp_password: str, api_key: str, institution_id: str):
    if not config.SMTP_USERNAME or not config.SMTP_PASSWORD:
        print(f"Skipping email to {admin_email}: SMTP credentials not configured.")
        return

    msg = EmailMessage()
    msg['Subject'] = f"Welcome to Fable, {institution_name}"
    msg['From'] = config.SMTP_FROM
    msg['To'] = admin_email

    dashboard_url = config.FRONTEND_URL.rstrip('/') + "/dashboard"
    sandbox_url = f"{config.FRONTEND_URL.rstrip('/')}/demo/{institution_id}"

    html_content = f"""
    <html>
      <body style="font-family: Arial, sans-serif; color: #333; line-height: 1.6;">
        <h2 style="color: #7C3AED;">Welcome to Fable</h2>
        <p>Your institution, <strong>{institution_name}</strong>, has been successfully provisioned on the Fable Intelligence Network.</p>
        
        <div style="background-color: #f9f9f9; border-left: 4px solid #7C3AED; padding: 15px; margin-bottom: 20px;">
          <h3 style="margin-top: 0;">Your Credentials</h3>
          <p><strong>Dashboard URL:</strong> <a href="{dashboard_url}">{dashboard_url}</a></p>
          <p><strong>Admin Email:</strong> {admin_email}</p>
          <p><strong>Temporary Password:</strong> <code style="background: #e2e8f0; padding: 2px 6px; border-radius: 4px;">{temp_password}</code></p>
          <p><em>Please log in and change your password immediately.</em></p>
        </div>

        <div style="background-color: #f9f9f9; border-left: 4px solid #00f5a0; padding: 15px; margin-bottom: 20px;">
          <h3 style="margin-top: 0;">API Integration</h3>
          <p><strong>API Key:</strong> <code style="background: #e2e8f0; padding: 2px 6px; border-radius: 4px;">{api_key}</code></p>
          <p>Use this key in the <code>Authorization: Bearer &lt;key&gt;</code> header to authenticate with the Fable Engine.</p>
          <p><strong>Webhook Endpoint:</strong> Configure your webhook receiver URL in the Dashboard Settings to receive real-time signals.</p>
        </div>

        <div style="background-color: #f9f9f9; border-left: 4px solid #7C3AED; padding: 15px; margin-bottom: 20px;">
          <h3 style="margin-top: 0;">Your Demo Bank</h3>
          <p>Your institution has its own sandbox banking app, pre-loaded with three
          customers and 90 days of their transaction history:</p>
          <p><a href="{sandbox_url}">{sandbox_url}</a></p>
          <p>Every transfer made there is tagged to <strong>{institution_name}</strong> and appears
          in your dashboard immediately. No other institution can see it.</p>
        </div>
        
        <p>Best,<br>The Fable Team</p>
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
        print(f"Provisioning email sent successfully to {admin_email}")
    except Exception as e:
        print(f"Failed to send email: {e}")
        # We don't raise here because we still want to return the keys if email fails

@router.post("/provision")
def provision_institution(req: ProvisionRequest, background_tasks: BackgroundTasks):
    temp_pw = generate_temp_password()
    api_key = generate_api_key()
    hashed_pw = hash_password(temp_pw)
    institution_id = slugify_institution(req.institution_name)

    # Save the generated API key and Admin User to the DB
    with cursor() as cur:
        cur.execute(
            "INSERT INTO api_keys (key, institution_name, admin_email, institution_id) VALUES (?, ?, ?, ?)",
            (api_key, req.institution_name, req.admin_email, institution_id)
        )
        cur.execute(
            "INSERT OR REPLACE INTO admins (email, institution_id, hashed_password) VALUES (?, ?, ?)",
            (req.admin_email, institution_id, hashed_pw)
        )

    register_institution(institution_id, req.institution_name, req.admin_email)

    # Give the new tenant a populated world to log into: three demo customers
    # with 90 days of their own history, scoped to this institution.
    seed_institution(institution_id, days=90)

    # Send email in background so the endpoint is fast
    background_tasks.add_task(
        send_provision_email, req.admin_email, req.institution_name, temp_pw, api_key, institution_id
    )

    return {
        "status": "success",
        "message": "Institution provisioned. Email sent to admin.",
        "data": {
            "institution_id": institution_id,
            "institution_name": req.institution_name,
            "admin_email": req.admin_email,
            "temp_password": temp_pw,
            "api_key": api_key,
            "demo_url": f"{config.FRONTEND_URL.rstrip('/')}/demo/{institution_id}",
        }
    }
