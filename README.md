<div align="center">
  <br />
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="public/images/brand/fable-logo-white.png">
    <img alt="Fable Logo" src="public/images/brand/fable-logo.png" width="220">
  </picture>
  <br />
  <br />

  <p><b>Behavioural fraud-risk scoring and cooling-window holds for Nigerian transfers.</b></p>

  <blockquote>
    <i>Transfers that fit the customer's own habits go straight through. The one that doesn't is checked, or held where the customer can still cancel it.</i>
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
    <a href="#-what-is-live-in-progress-and-planned">Status</a> •
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
- **Fake officials and fake investments:** "your account is under review", "double your money by Friday".
- **Urgency Scripts:** Crafted messages in English and Nigerian Pidgin designed to trigger panic and bypass rational thought.
- **Account takeover and mules:** A stolen login, a new device, and money routed to an account the customer has never paid.

Because the user themselves is convinced to authorize the transfer, traditional rule-based fraud systems (which only look for credential stuffing or geographic anomalies) fail. They see a legitimate user, on a legitimate device, entering a legitimate OTP. 

To the bank, it looks like a perfect transaction. To the user, it is a catastrophic loss.

<br />

## 🛡 The Fable Solution: Context-Aware Defense

**Fable** is an API that a bank, wallet, payment service provider or lender calls before a transfer is sent.

It compares the transfer with that customer's own history: who they pay, how much, when, from which device and where. KYC answers "is this the right person?" once, at onboarding. Fable asks, on every transfer, "does this look like something this customer does?", which is the question a social engineering scam fails.

Transfers that fit go through with no extra step. One that doesn't gets a PIN, passkey or code check, or a hold the customer can cancel, before the money leaves.

### Why Fable is Different:
1. **Behavioral over Identity:** We assume the user is logged in perfectly. We secure their *intent*, not just their credentials.
2. **Security Without Friction:** Safe users get *fewer* prompts than today, not more.
3. **Context, Not Just Payload:** Device, location, session timing, typing and paste signals, recipient history and narration.
4. **Transparency by Design:** Every intervention is explained in plain English. No black-box rejections.
5. **Containment over Cancellation:** When a customer insists on a blocked transfer, it is held for a cooling window instead of sent, and scoring never fails open.

<br />

## 🧠 The Three Fable Agents

Three parts, each with one job, deciding inside a `200ms` budget before the transfer goes to NIP. Copilot, Shield and Ghost are live today; Watch is planned.

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
      Learns each customer's usual amounts, recipients, hours, devices and places from their history. A customer with no history yet is compared with the institution's customers as a whole. <i>Example: Ada paying her landlord on the 1st of the month.</i>
    </td>
    <td valign="top">
      <b>Real-Time Interception.</b><br/>
      Scores the transfer against that baseline: amount, recipient, timing, device, location, session, typing, channel, NIP codes and scam-script narrations (e.g. "urgent help abeg"). Every flag or block comes with a plain-language reason, from a template, or from Claude or GPT-4o when configured, without blaming the customer.
    </td>
    <td valign="top">
      <b>Blast-Radius Containment.</b><br/>
      If a customer insists on a blocked transfer, Ghost holds it for a cooling window (5 to 15 minutes by default, set per institution). The customer can cancel for free, or release it only with stronger proof. Live, the bank keeps the funds and acts on Fable's webhooks.
    </td>
  </tr>
</table>

### Agent Deep-Dive: Shield Signal Layers
Shield adds up its signals into a risk score from 0.0 to 1.0, then softens it slightly for customers with a long clean record:
- **Amount anomaly:** how far above the customer's own baseline, with tiers past 10x, 25x and 50x. With no history, the amount itself is priced in tiers from NGN 100k to NGN 20m.
- **Recipient and timing:** new recipient, time of day on the device clock, timezone mismatch.
- **Channel and rail:** channel weights drawn from NIBSS fraud data (internet banking highest, branch lowest) and NIP response codes.
- **Social engineering:** narration matched against the Nigerian scam-pattern library (deliberately a weak signal).
- **Device, location and session:** unrecognised device, new city or country, a large transfer right after login.
- **Behavioural biometrics:** pasted account numbers, near-zero hesitation.
- **History and velocity:** how far the amount and hour together sit from the customer's own past transfers, bursts of transfers, recent failed verifications.

Decisions are `PASS`, `FLAG` or `BLOCK`. The cutoffs default to 0.5 and 0.8 and are tuned per channel. Shield never fails open: if scoring throws, it returns a conservative `FLAG`. Weights live in governed engine versions: a change is proposed, approved by a second person (or after a cooling-off period for a single owner), can run in shadow first, and every decision records the version that made it. Full weights are in the [scoring docs](src/content/docs/03-scoring.md) and [docs/ENGINE-GOVERNANCE.md](docs/ENGINE-GOVERNANCE.md).

When a flagged transfer needs proof, the step-up engine picks the lightest factor that holds: PIN, device passkey, passkey plus a one-time code (email or SMS), or passkey, code and PIN together. Releasing a Ghost hold always costs one tier more than the transfer itself, and only factors set up before the decision count.

<br />

## 🚦 What is Live, In Progress and Planned

| Status | What |
|---|---|
| **Live** | Per-customer scoring with Copilot and Shield; per-customer data export and erasure, scheduled retention, coarse location and a customer location switch; step-up with PIN, passkeys and one-time codes; Ghost holds with release, cancel, expiry and "ask my bank to release"; signed webhooks with a durable outbox; the institution console (review queue, customers, risk policy, roles, imports, audit, Ask Fable); the operator platform with two-person approval for keys and engine changes; the sandbox app and sandbox inbox |
| **Live when configured** | SMS codes and alerts through Termii or Africa's Talking (including its free sandbox); AI-written explanations through Anthropic or OpenAI; email through your mail server |
| **In progress** | First-transfer amount weights and the new anomaly model ship as a draft engine version for an owner to propose, shadow and promote |
| **Planned** | Watch (monitoring between transfers); cross-institution intelligence (each institution's data is strictly its own today); a face or liveness check through a KYC provider; published SDK packages on npm and PyPI |

<br />

## 🏗 Repository Architecture

One repository: a Python (FastAPI) scoring service and a Next.js frontend.

```text
fable/
├── api/                           # 🧠 FastAPI backend (scoring, holds, console API)
│   ├── main.py                    # App entry point: middleware, routers, startup
│   ├── core/                      # Plumbing: config, database and migrations, sessions,
│   │                              #   tenancy and roles, password and API-key hashing
│   ├── services/                  # Domain logic: ledger, audit log, branding, notifications,
│   │                              #   risk policy, signed webhooks, scheduler, email and SMS
│   ├── agents/
│   │   ├── copilot/               # Baseline profiling and the analyst assistant
│   │   ├── shield/                # Scoring, step-up and assurance, explanations
│   │   └── ghost/                 # Containment holds and release
│   ├── intelligence/              # Scam patterns and fraud context
│   ├── middleware/                # API-key auth, rate limiting, latency
│   ├── models/                    # Request and response schemas
│   ├── routers/                   # /v1/shield, /v1/ghost, /v1/review, /v1/team, /v1/webhooks, /auth, ...
│   ├── scripts/                   # Operator tools: rename or remove institutions, PIN reset, admin email
│   ├── tests/                     # Scoring, endpoint, tenancy, hold, console-workflow and migration tests
│   ├── eval/                      # Offline evaluation harness for labelled transactions
│   ├── Dockerfile                 # Production image
│   ├── docker-compose.yml
│   ├── ruff.toml, pytest.ini      # Tool settings (import sorting, tests)
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
│   ├── lib/fable/                 # Browser client: API calls, fingerprint, geolocation, passkeys
│   └── proxy.ts                   # Console route guard (Next 16's renamed middleware)
│
├── e2e/                           # Playwright browser tests for the sandbox app and console
│
├── sdk/                           # Reference clients for Node and Python (no dependencies)
├── docs/                          # Internal guides: deployment, system guide, plans
├── public/                        # Static assets and brand logos
└── LICENSE                        # Proprietary, all rights reserved
```

### The Technology Stack
- **Backend API:** Python 3.12, FastAPI, SQLite
- **AI Integration:** Anthropic Claude then OpenAI GPT-4o for plain-language explanations and the analyst assistant, both optional with a deterministic fallback; a nearest-neighbour anomaly model on each customer's own history (the retiring Isolation Forest uses scikit-learn)
- **Identity:** WebAuthn passkeys (`py_webauthn`), hashed PINs, one-time codes by email or SMS
- **Frontend App:** Next.js 16 (App Router), React 19, Tailwind CSS v4
- **UI Components:** Phosphor Icons, Sonner, react-markdown
- **Third-party services:** Paystack (account-name resolution), Google Maps Geocoding, ipapi.co, OpenStreetMap Nominatim and BigDataCloud (location), SMTP (email), Termii or Africa's Talking (SMS), all optional
- **Hosting:** Vercel (frontend), a Docker Compose deployment on a VPS (backend). See [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md)

<br />

## 🚀 Local Setup Guide

Run the API and the frontend locally.

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
*📚 Interactive API documentation is generated at `http://localhost:8000/docs`. Run the tests with `pytest`, and the browser tests from the repository root with `pnpm test:e2e`. On a machine where Windows blocks compiled Python packages, run both on Linux in Docker instead: see [docs/DEPLOYMENT.md, section 11](docs/DEPLOYMENT.md#11-running-on-linux-locally-tests-and-the-api-like-production).*

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

If the API is unreachable, the sandbox app says so and sends nothing; it never makes a decision on the device. `http://localhost:8000/health` shows the database, background jobs and webhook outbox.

<br />

## 🎮 The 90-Second Demo

Fable ships a sandbox banking app. Each institution gets its own at `/demo/{institution}`, open to its console members, using the test customers it imports or adds. There is no built-in demo data: import a few test customers with history shaped like a trader, a salaried worker and a student (CSV templates are in **Settings > Data**), then try the scenarios below. See the [quickstart](src/content/docs/02-quickstart.md).

### ✅ Scenario 1: Same amount, different customers
*Per-customer baselines in action.*
1. Open `http://localhost:3000/demo/{your-institution}` and pick the **trader** from the customer switcher.
2. Send **₦250,000** to a new 10-digit account. For a trader who moves that much every week, it passes silently.
3. Switch to the **student** and send the same ₦250,000. It is many times her normal, so Shield asks for a check or stops it. The exact result depends on the history you imported.

### 🚨 Scenario 2: Suspicious transfer (BLOCK)
*Shield catching a social-engineering shape.*
1. As the student, send **₦500,000** to a new account over **Web** (internet banking).
2. Narration: `urgent help abeg` (matches the Pidgin urgency script).
3. Result: Shield intercepts it and explains, in plain language, why.

### 🛡️ Scenario 3: Override and contain (GHOST)
*Containment when the user ignores the warning.*
1. On the blocked screen, choose to send anyway.
2. Nothing goes to the recipient. Ghost holds it in a cooling window and tells the customer on another channel (in the sandbox, the sandbox inbox).
3. **Cancel** keeps the money in the account. **Release** demands a stronger factor than the transfer did, set up before the transfer. A customer without one can ask the bank to release it from the console.

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
| **Settings** | Profile, branding, risk policy (your own thresholds and hold windows), team and roles, data imports, API key and webhooks, and the go-live checklist |
| **Ask Fable** | An analyst assistant that answers from the institution's own figures, with customers pseudonymised before any AI provider sees a question |

Fable staff run a separate **operator platform** at `/operator` (password plus authenticator, with roles): they create institutions empty, follow their setup, set Ask Fable's limits, manage integration keys with two-owner approval (see [docs/SECRETS.md](docs/SECRETS.md)), propose, shadow and promote scoring engine versions, and read the full audit log.

Console users have a role, enforced by the API: **owner** (everything), **analyst** (works the review queue) or **viewer** (read only).

<br />

## 📖 API Documentation

Institutions call one endpoint before sending a transfer. A clean transfer is that one call; a flagged one adds a verification step. Full reference: the public docs at `/docs` on the site (source in [src/content/docs](src/content/docs)) and the OpenAPI spec at `/docs` on the API host.

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
- `POST /v1/ghost/create` - Hold a blocked transfer the customer insists on, by its `transaction_id`.
- `POST /v1/ghost/{id}/cancel` - End the hold; the money stays with the customer. No proof needed.
- `POST /v1/ghost/{id}/confirm` - Release the transfer. Requires a step-up token.
- `POST /v1/ghost/{id}/request-release` - Ask the bank to release it instead.
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
| [docs/SECRETS.md](docs/SECRETS.md) | Integration keys and settings managed from the operator console |
| [docs/ENGINE-GOVERNANCE.md](docs/ENGINE-GOVERNANCE.md) | How scoring weights are changed, approved, shadowed and promoted |
| [docs/PIN-RECOVERY.md](docs/PIN-RECOVERY.md) | Clearing a customer's PIN, and backing up the database safely |
| [api/eval/README.md](api/eval/README.md) | Measuring Shield's weights against labelled outcomes |

<br />

## 🗄️ Data Model

The backend stores everything in SQLite (`api/fable.db`), with the schema and in-place migrations in [api/core/db.py](api/core/db.py). Core tables: `customers` and `transaction_history` (imported), `transactions` (decisions, with review state, outcome and engine version), `case_notes`, `ghost_containers`, `institutions`, `institution_settings` (risk policy), `institution_branding`, `admins` (with roles), `api_keys`, `webhooks`, `webhook_outbox` and `webhook_deliveries`, `accounts` and `ledger_entries` (sandbox balances), `user_security` and `user_credentials` (PIN hash and passkey public keys), `stepup_challenges` and `stepup_tokens`, `device_profiles` and `customer_devices`, `user_locations`, `notifications`, `sandbox_inbox`, `engine_versions`, `job_runs` and `audit_log`. Every row is scoped to an institution.

<br />

## 📜 Ownership & License

Fable is proprietary software. Copyright (c) 2026 Fable. All rights reserved.

The source is visible for review and evaluation only. Copying, forking for reuse, redistributing, or using any part of it (code, scam-pattern data, designs, or branding) in another project, product, or submission is not permitted without written permission. See [LICENSE](LICENSE) for the full terms. How the hosted platform itself is governed is in the site's Terms and Privacy pages.

Contributions are accepted from invited collaborators only. To request permission to use anything here, contact the owner at [github.com/kenzycodex](https://github.com/kenzycodex).

<br />

---
