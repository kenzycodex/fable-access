# Fable B2B Onboarding & Demo Flow

## The Problem
Fable is a **B2B finance infrastructure** product — there's no self-serve "Sign Up" button. Businesses (banks, fintechs, wallets) are provisioned by Fable, not by themselves. We need a clean flow for:
1. Creating a business on the platform
2. Giving them dashboard access
3. Letting them test with the demo bank (critical for hackathon pitch day)

---

## Proposed Architecture

### 1. Business Provisioning (API Endpoint)

A Fable admin triggers an endpoint to create a new business:

```bash
curl -X POST http://localhost:8000/admin/provision \
  -H "Content-Type: application/json" \
  -d '{"institution_name": "Meridian Bank", "admin_email": "cto@meridian.ng"}'
```

**What the script does:**
- Creates the institution record in the FastAPI backend database
- Generates API credentials (`fbl_live_xxxx` secret key)
- Saves the API key securely into the local `fable.db` SQLite database
- Generates an admin user with a random secure password
- Sends a welcome email via SMTP with login credentials

### 2. Credential Delivery (Email)

The business receives an email with:
- Dashboard URL: `http://localhost:3000/dashboard` (dynamically pulled from FRONTEND_URL env var)
- Login email (their business email)
- Temporary password (must change on first login)
- API key (masked, full key visible in dashboard)

### 3. Dashboard Access

Business logs in → sees their institution dashboard:
- Configure agents (toggle Shield, Ghost, Watch)
- View API Reference (`http://localhost:8000/docs`)
- View transaction stream (empty until integrated)
- Settings & billing

### 4. Sandbox (Demo Bank) Integration 

The demo bank acts as a **sandbox environment** accessible directly from the Fable dashboard navigation.

- A "Sandbox (Demo Bank)" tab/section in the dashboard sidebar
- Pre-seeded test accounts (Alice, Bob, Charlie)
- Ability to make test transfers that flow through Fable's agents
- The demo bank UI is accessible at `/demo`

**Pitch day flow:**
1. Show the marketing site → explain the problem
2. Log into the dashboard → show the agent configs
3. Click "Sandbox (Demo Bank)" in the sidebar → make a live transfer
4. Switch back to dashboard → show the transaction intercepted and scored in the live stream

---

## Summary

The core of the onboarding flow runs entirely inside the `POST /admin/provision` FastAPI route, sending HTML emails and registering keys to a local SQLite database that validates requests dynamically in the `APIKeyMiddleware`.
