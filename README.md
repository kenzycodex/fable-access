<div align="center">
  <br />
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="public/images/brand/fable-logo-white.png">
    <img alt="Fable Logo" src="public/images/brand/fable-logo.png" width="220">
  </picture>
  <br />
  <br />

  <p><b>Next-Generation AI Security & Intelligence Infrastructure for African Finance.</b></p>

  <blockquote>
    <i>"Security that disappears when you're safe. Shows up hard when you're not."</i>
  </blockquote>

  <p>
    <img src="https://img.shields.io/badge/Next.js%2016-black?style=for-the-badge&logo=nextdotjs&logoColor=white" alt="Next.js" />
    <img src="https://img.shields.io/badge/FastAPI-005571?style=for-the-badge&logo=fastapi" alt="FastAPI" />
    <img src="https://img.shields.io/badge/Claude-D97757?style=for-the-badge&logo=anthropic&logoColor=white" alt="Claude" />
    <img src="https://img.shields.io/badge/Python_3.12-3776AB?style=for-the-badge&logo=python&logoColor=white" alt="Python" />
    <img src="https://img.shields.io/badge/Docker-2496ED?style=for-the-badge&logo=docker&logoColor=white" alt="Docker" />
    <img src="https://img.shields.io/badge/React_19-61DAFB?style=for-the-badge&logo=react&logoColor=black" alt="React 19" />
  </p>

  <p>
    <a href="#-the-problem">Problem</a> •
    <a href="#-the-fable-solution">Solution</a> •
    <a href="#-the-three-fable-agents">Agents</a> •
    <a href="#-repository-architecture">Architecture</a> •
    <a href="#-local-setup-guide">Setup</a> •
    <a href="#-the-90-second-demo">Demo Guide</a> •
    <a href="#-api-documentation">API</a> •
    <a href="#-ownership--license">License</a>
  </p>
</div>

---

<br />

## 🌍 The Problem: The Evolution of Financial Fraud

Every bank's fraud system kicks in *after* the user hits send. By then, the scammer has already won. 

In the modern digital banking era—particularly across emerging African markets like Nigeria—scams no longer happen inside the banking apps themselves. The technological perimeters (2FA, biometric logins, hardware tokens) are generally secure against brute force. Instead, **the human is the vulnerability**.

Scams happen on WhatsApp, phone calls, and cloned websites in the five minutes before the transaction. They manifest as:
- **Social Engineering & Impersonation:** Scammers posing as family members in distress.
- **Deepfake Voice Clones:** AI-generated audio bypassing the "I know their voice" heuristic.
- **Urgency Scripts:** Crafted messages in local dialects (like Nigerian Pidgin) designed to trigger panic and bypass rational thought.
- **Business Email Compromise (BEC):** Fake supplier invoices routing funds to mule accounts.

Because the user themselves is convinced to authorize the transfer, traditional rule-based fraud systems (which only look for credential stuffing or geographic anomalies) fail. They see a legitimate user, on a legitimate device, entering a legitimate OTP. 

To the bank, it looks like a perfect transaction. To the user, it is a catastrophic loss.

<br />

## 🛡 The Fable Solution: Context-Aware Defense

**Fable** is an API-first AI security and intelligence infrastructure layer that sits dynamically between the user and the transaction.

Rather than looking solely at the technical payload, Fable looks at the **context**. While existing platforms focus on *Identity Intelligence* (answering "Is this person who they say they are?"), Fable focuses on **Behavioral Intelligence** (answering "Is this person acting under manipulation or duress?").

It knows each user's genuine behavioral habits so deeply that safe transfers go through with zero friction, while anomalous, suspicious transfers get caught before money leaves the account.

### Why Fable is Different:
1. **Behavioral over Identity:** We assume the user is logged in perfectly. We secure their *intent*, not just their credentials.
2. **Security Without Friction:** Safe users get *fewer* prompts than today, not more.
3. **Context, Not Just Payload:** It reads the "room" (device velocity, recipient age, narration semantics).
4. **Transparency by Design:** Every intervention is explained in plain English. No black-box rejections.
5. **Containment over Cancellation:** When users override warnings, Fable contains the blast radius rather than failing open.

<br />

## 🧠 The Three Fable Agents

Fable doesn't use a monolithic risk engine. It relies on a multi-agent system that decides inside a `200ms` budget, before the transaction clears the central switch (e.g., NIBSS). Copilot, Shield and Ghost are live today; Watch is on the roadmap.

<table>
  <tr>
    <td align="center" width="33%">
      <h3>🤝 Copilot</h3>
      <b>The Personalization Engine</b>
    </td>
    <td align="center" width="33%">
      <h3>⚔️ Shield</h3>
      <b>The Threat Defense</b>
    </td>
    <td align="center" width="33%">
      <h3>👻 Ghost</h3>
      <b>The Containment Layer</b>
    </td>
  </tr>
  <tr>
    <td valign="top">
      <b>Always On, Passive.</b><br/>
      Analyzes historical transactions, trusted channels, and payment hours. Builds a unique mathematical baseline for every user. If a transaction matches the baseline, it is approved silently. Zero friction. <i>Example: Ada paying her landlord on the 1st of the month.</i>
    </td>
    <td valign="top">
      <b>Real-Time Interception.</b><br/>
      Catches social engineering, deepfakes, and channel anomalies. Evaluates payload semantics (e.g., "urgent help abeg" in Pidgin). When it flags or blocks a transaction, a plain-English explanation is generated (Claude, falling back to GPT-4o, then a local template) without blaming the user.
    </td>
    <td valign="top">
      <b>Blast-Radius Containment.</b><br/>
      If a user overrides a Shield block, Ghost holds the funds in an isolated Smart Container for a 15-minute cooling window. The scammer gets nothing. Once the adrenaline wears off, the user can cancel safely.
    </td>
  </tr>
</table>

### Agent Deep-Dive: Shield Signal Layers
Shield computes a risk score (0.0 to 1.0) from fourteen additive signal layers, then softens it slightly for customers with a long clean record:
- **Amount anomaly:** how far above the customer's own baseline, with tiers past 10x, 25x and 50x.
- **Recipient and timing:** new recipient, time of day on the device clock, timezone mismatch.
- **Channel and rail:** NIBSS channel weights (USSD highest) and NIP response codes.
- **Social engineering:** narration matched against the Nigerian scam-pattern library (deliberately a weak signal).
- **Device, location and session:** unrecognised device, new city or country, a large transfer right after login.
- **Behavioural biometrics:** pasted account numbers, near-zero hesitation.
- **History and velocity:** Isolation Forest deviation, bursts of transfers, recent failed verifications.

Decisions are `PASS`, `FLAG` or `BLOCK`. The cutoffs default to 0.5 and 0.8 and are tuned per channel. Shield never fails open: if scoring throws, it returns a conservative `FLAG`. Full weights are in the [scoring docs](src/content/docs/03-scoring.md).

When a flagged transfer needs proof, the step-up engine picks the lightest factor that holds: PIN, device passkey, passkey plus emailed code, or an identity check. Releasing a Ghost container always costs one tier more than the transfer itself.

<br />

## 🏗 Repository Architecture

Fable is structured as a powerful monorepo containing a high-performance Python AI backend and a Next.js full-stack frontend.

```text
fable/
├── api/                           # 🧠 FastAPI Python Backend (Intelligence Layer)
│   ├── main.py                    # App entry point: middleware, routers, startup
│   ├── core/                      # Plumbing: config, database and migrations, sessions,
│   │                              #   tenancy and roles, password and API-key hashing
│   ├── services/                  # Domain logic: ledger, audit log, branding, notifications,
│   │                              #   risk policy, signed webhooks, geocoding
│   ├── agents/
│   │   ├── copilot/               # Baseline profiling and the analyst assistant
│   │   ├── shield/                # Scoring, step-up and assurance, explanations
│   │   └── ghost/                 # Containment holds and release
│   ├── intelligence/              # Scam patterns and fraud context
│   ├── middleware/                # API-key auth, rate limiting, latency
│   ├── models/                    # Request and response schemas
│   ├── routers/                   # /v1/shield, /v1/ghost, /v1/review, /v1/team, /v1/webhooks, /auth, ...
│   ├── scripts/                   # Operator tools: rename or remove institutions, PIN reset, admin email
│   ├── tests/                     # Scoring, endpoint, console-workflow and migration tests
│   ├── eval/                      # Offline evaluation harness for labelled transactions
│   ├── Dockerfile                 # Production image
│   ├── docker-compose.yml
│   ├── pyproject.toml             # Tool settings (Ruff, pytest)
│   ├── requirements.txt           # What the app needs
│   └── requirements-dev.txt       # Plus pytest and Ruff, for tests and linting
│
├── src/                           # 💻 Next.js 16 Frontend
│   ├── app/
│   │   ├── (marketing)/           # Public site: home, platform, pricing, privacy, terms
│   │   ├── dashboard/             # B2B institution console
│   │   ├── demo/[institution]/    # Mobile-first demo bank, one per institution
│   │   └── docs/                  # Public documentation
│   ├── content/docs/              # The documentation source (Markdown)
│   ├── components/                # UI (Tailwind)
│   ├── lib/fable/                 # Fable client SDK: fingerprint, geolocation, scoring fallback
│   └── middleware.ts              # Console route guard
│
├── sdk/                           # Reference clients for Node and Python (no dependencies)
├── docs/                          # Internal guides: deployment, system guide, plans
├── public/                        # Static assets and brand logos
└── LICENSE                        # Proprietary, all rights reserved
```

### The Technology Stack
- **Backend API:** Python 3.12, FastAPI, SQLite
- **AI Integration:** Anthropic Claude then OpenAI GPT-4o for plain-language explanations and the analyst assistant, both optional with a deterministic fallback; scikit-learn Isolation Forest for anomaly scoring
- **Identity:** WebAuthn passkeys (`py_webauthn`), hashed PINs, emailed one-time codes
- **Frontend App:** Next.js 16 (App Router), React 19, Tailwind CSS v4
- **UI Components:** Phosphor Icons, Sonner, react-markdown
- **Third-party services:** Paystack (account-name resolution), Google Maps Geocoding, ipapi.co, OpenStreetMap Nominatim and BigDataCloud (location), SMTP (verification and provisioning email)
- **Hosting:** Vercel (frontend), a Docker Compose deployment on a VPS (backend). See [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md)

<br />

## 🚀 Local Setup Guide

Spin up the entire Fable ecosystem locally with just a few commands. The system is designed to run locally with minimal friction for development and testing.

### Prerequisites
- Node.js 20+ and `pnpm` (or `npm`)
- Python 3.12+
- Optional: an Anthropic or OpenAI key for AI-written explanations. With no key set, Shield still returns full scores and signals and falls back to a local template.

### 1. Start the Intelligence API (Backend)
The backend runs on port `8000` locally and handles all scoring logic. (The Docker image listens on `8010`; see the deployment guide.)

```bash
cd api

# Create and activate a virtual environment
python -m venv .venv
source .venv/bin/activate  # On Windows: .venv\Scripts\activate

pip install -r requirements-dev.txt   # the app's requirements, plus pytest

# Environment (every key is optional for local use)
cp .env.example .env
# Set a session secret, or console sign-ins reset every time the API reloads:
#   python -c "import secrets; print(secrets.token_urlsafe(48))"  ->  FABLE_SESSION_SECRET in .env

uvicorn main:app --port 8000 --reload
```
*📚 Interactive API documentation is generated at `http://localhost:8000/docs`. Run the tests with `pytest`.*

### 2. Start the Fable Platform (Frontend)
The Next.js frontend runs on port `3000` and hosts the marketing site, the console and the demo bank.

```bash
# In a new terminal at the repository root
pnpm install

# Point the frontend at the API (it defaults to http://localhost:8000)
echo "NEXT_PUBLIC_FABLE_API_URL=http://localhost:8000" > .env.local
# Restart `pnpm dev` after changing it: the security headers are built at startup.
# Optional: add PAYSTACK_SECRET_KEY=sk_test_... for real account-name resolution

pnpm dev
```
*🌐 The platform is now at `http://localhost:3000`. Data lives in `api/fable.db` (SQLite), created on first run.*

If the API is unreachable, the demo bank falls back to a local scoring engine and queues transfers for sync, so a healthy-looking screen does not prove the backend is up. Check `http://localhost:8000/health`.

<br />

## 🎮 The 90-Second Demo

Fable ships a simulated mobile banking app. Each institution gets its own at `/demo/{institution}`, pre-loaded with two customers (a trader and a student; set `FABLE_DEMO_CUSTOMERS=3` for a third) and 90 days of history. Provision an institution to try it (see the [quickstart](src/content/docs/02-quickstart.md)). Customer names differ from one institution to the next, but the two profiles are always the same.

### ✅ Scenario 1: Same amount, different customers
*Per-customer baselines in action.*
1. Open `http://localhost:3000/demo/{your-institution}` and pick the **trader** from the customer switcher.
2. Send **₦250,000** to a new 10-digit account. Result: **PASS**, silently.
3. Switch to the **student** and send the same ₦250,000. Result: **BLOCK**, because it is roughly fifty times her normal. A salaried customer in between gets a **FLAG** and a verification step.

### 🚨 Scenario 2: Suspicious transfer (BLOCK)
*Shield catching a social-engineering shape.*
1. As the student, send **₦500,000** to a new account over **USSD**.
2. Narration: `urgent help abeg` (matches the Pidgin urgency script).
3. Result: Shield intercepts it and explains, in plain language, why.

### 🛡️ Scenario 3: Override and contain (GHOST)
*Containment when the user ignores the warning.*
1. On the blocked screen, choose to send anyway.
2. The money is not released to the recipient. Ghost holds it in a cooling window and notifies the customer out-of-band.
3. **Cancel** returns the money instantly. **Release** demands a stronger factor than the transfer did.

### 🖥️ Scenario 4: The console
Sign in at `/dashboard/login` and see the same transfers from the institution's side, scoped to that institution only.

| Page | What it is for |
|---|---|
| **Overview** | Live decisions, money kept from fraud, decision time, and what needs review |
| **Review queue** | Every flagged or blocked transfer as a case: assign, add notes, escalate, and resolve as fraud or legitimate. Labelling a case never moves money |
| **Transactions** | The full log with 7, 30 and 90 day ranges and CSV export |
| **Customers** | Each customer's baseline, verification status, history and cases |
| **Agents, Insights** | What Copilot, Shield and Ghost are doing, and which scams and signals recur |
| **Compliance** | The audit trail, an incident log, CSV export and a printable board report |
| **Settings** | Profile, branding, risk policy (your own thresholds and hold windows), team and roles, API key and webhooks |

Console users have a role, enforced by the API: **owner** (everything), **analyst** (works the review queue) or **viewer** (read only).

<br />

## 📖 API Documentation

Fable is built API-first. Institutions call one endpoint before letting a transfer process. Full reference: the public docs at `/docs` on the site (source in [src/content/docs](src/content/docs)) and the OpenAPI spec at `/docs` on the API host.

### `POST /v1/shield/analyze`
Authenticate with `X-API-Key: fbl_live_...`.

**Request:**
```json
{
  "user_id": "usr_44210",
  "transaction": {
    "amount": 150000,
    "currency": "NGN",
    "recipient_account": "0123456789",
    "recipient_bank_code": "058",
    "recipient_name": "ADEOLA MUSA",
    "channel": "mobile_app",
    "narration": "urgent help abeg"
  },
  "device": { "fingerprint_id": "fp_9c1e4b7a", "timezone": "Africa/Lagos" },
  "context": { "session_duration_seconds": 14, "paste_detected": true },
  "client_reference": "txn_8f2ac1"
}
```

**Response:**
```json
{
  "risk_score": 0.64,
  "risk_level": "MEDIUM",
  "action": "FLAG",
  "signals": [
    "amount_anomaly: 12x above your baseline (+0.28)",
    "new_recipient: first transfer to this account (+0.2)",
    "scam_pattern: urgency script (+0.13)"
  ],
  "explanation": "This is much larger than your usual transfers, to someone you have never paid before...",
  "decision_ms": 48.2,
  "latency_ms": 51.7,
  "explanation_source": "template",
  "transaction_id": "txn_a1b2c3d4e5f6"
}
```

### Other key endpoints
- `POST /v1/ghost/create` - Hold an overridden transfer in a cooling window.
- `POST /v1/ghost/{id}/cancel` - Return the held money. No proof needed.
- `POST /v1/ghost/{id}/confirm` - Release the money. Requires a step-up token.
- `POST /v1/stepup/requirement` - Which factor does this decision need?
- `GET /v1/copilot/transparency/{user_id}` - Everything Fable has learned about a customer's baseline.

<br />

## 📚 Documentation

| Guide | What it covers |
|---|---|
| [Public docs](src/content/docs) | Overview, quickstart, scoring, identity assurance, API reference, integration guide |
| [sdk/README.md](sdk/README.md) | Node and Python reference clients, including webhook verification |
| [docs/SYSTEM-GUIDE.md](docs/SYSTEM-GUIDE.md) | How the whole system fits together, and its honest limits |
| [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) | Vercel plus a Docker Compose backend on a VPS, updates, backups and maintenance scripts |
| [docs/PIN-RECOVERY.md](docs/PIN-RECOVERY.md) | Clearing a customer's PIN, and backing up the database safely |
| [api/eval/README.md](api/eval/README.md) | Measuring Shield's weights against labelled outcomes |

<br />

## 🗄️ Data Model

The backend stores everything in SQLite (`api/fable.db`), with the schema and in-place migrations in [api/core/db.py](api/core/db.py). Core tables: `transactions` (with review state, outcome and assignee), `case_notes`, `ghost_containers`, `fable_users`, `institutions`, `institution_settings` (risk policy), `institution_branding`, `admins` (with roles), `api_keys`, `webhooks` and `webhook_deliveries`, `accounts` and `ledger_entries`, `user_security` and `user_credentials` (PIN hash and passkey public keys), `stepup_challenges`, `device_profiles`, `user_locations`, `notifications`, `audit_log`, and `institution_aliases` and `user_aliases` (former ids after a rename). Every row is scoped to an institution.

<br />

## 📜 Ownership & License

Fable is proprietary software. Copyright (c) 2026 Fable. All rights reserved.

The source is visible for review and evaluation only. Copying, forking for reuse, redistributing, or using any part of it (code, scam-pattern data, designs, or branding) in another project, product, or submission is not permitted without written permission. See [LICENSE](LICENSE) for the full terms. How the hosted platform itself is governed is in the site's Terms and Privacy pages.

Contributions are accepted from invited collaborators only. To request permission to use anything here, contact the owner at [github.com/kenzycodex](https://github.com/kenzycodex).

<br />

---
