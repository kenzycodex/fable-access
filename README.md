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
    <img src="https://img.shields.io/badge/Prisma-2D3748?style=for-the-badge&logo=prisma&logoColor=white" alt="Prisma" />
    <img src="https://img.shields.io/badge/OpenAI-412991?style=for-the-badge&logo=openai&logoColor=white" alt="OpenAI" />
    <img src="https://img.shields.io/badge/Python_3.12-3776AB?style=for-the-badge&logo=python&logoColor=white" alt="Python" />
  </p>

  <p>
    <a href="#-the-three-fable-agents">Agents</a> •
    <a href="#-repository-architecture">Architecture</a> •
    <a href="#-local-setup">Setup</a> •
    <a href="#-the-90-second-demo">Demo Guide</a>
  </p>
</div>

---

<br />

### 🌍 The Problem
Every bank's fraud system kicks in *after* the user hits send. By then, the scammer has already won. Scams today don't happen inside banking apps. They happen on WhatsApp, phone calls, and fake websites in the five minutes before. Social engineering convinces the user themselves to authorize the transfer.

### 🛡 The Fable Solution
An AI security and intelligence infrastructure layer that sits between the user and the transaction. It knows each user's genuine habits so deeply that safe transfers go through with zero friction, and the one suspicious transfer gets caught before money leaves the account.

<br />

## 🧠 The Three Fable Agents

Fable doesn't use a monolithic risk engine. It relies on a multi-agent system executing in under `200ms` before the transaction clears the NIBSS switch.

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
    <td valign="top">Analyzes historical transactions, trusted channels, and payment hours. If it matches the baseline, the transaction is approved silently. Zero friction.</td>
    <td valign="top">Catches social engineering, deepfakes, and channel anomalies. When it blocks a transaction, GPT-4o generates a plain-English explanation without blaming the user.</td>
    <td valign="top">If a user overrides a Shield block, Ghost holds the funds in an isolated container for a 15-minute cooling window, saving the money from the scammer.</td>
  </tr>
</table>

<br />

## 🏗 Repository Architecture

Fable is structured as a powerful monorepo containing a high-performance Python AI backend and a Next.js full-stack frontend.

<details open>
<summary><b>1. The Fable Intelligence API <code>(/api)</code></b></summary>
<br/>
The core infrastructure layer. Banks and fintechs plug into this API to route transactions through our autonomous agents.

- **Framework:** Python 3.12, FastAPI
- **Datastore:** SQLite (`fable.db`) for isolated agent state
- **Core Agents:** Shield, Copilot, Ghost

</details>

<details open>
<summary><b>2. The Fable Platform <code>(/src & /prisma)</code></b></summary>
<br/>
A robust Next.js application hosting the marketing site, B2B Institution Dashboard, and a fully functional Mobile Demo Bank.

- **Framework:** Next.js 16 (React 19)
- **Styling:** TailwindCSS v4, Phosphor Icons, Framer Motion
- **Database:** Prisma ORM mapped to SQLite

</details>

<br />

## 🚀 Local Setup

Spin up the entire Fable ecosystem locally with just a few commands.

### Backend (`/api`)
```bash
cd api
python -m venv .venv
source .venv/bin/activate  # or .venv\Scripts\activate on Windows
pip install -r requirements.txt
uvicorn main:app --port 8010 --reload
```
*📚 API Docs available at `http://localhost:8010/docs`*

### Frontend (`/src`)
```bash
# In a new terminal window at the root directory
npm install
npm run db:setup
npm run dev
```
*🌐 Platform available at `http://localhost:3000`*

<br />

## 🎮 The 90-Second Demo

Want to see Fable in action? Open `http://localhost:3000/demo` and follow these precise cheat codes:

#### ✅ 1. Normal Transfer (PASS)
- **Select:** `Mum`, `Landlord`, or `Chioma` (Keep the amount small).
- **Tap:** `Analyze & Send`
- **Watch:** Copilot clears it silently with an instant green flash. Risk score is extremely low.

#### 🚨 2. Suspicious Transfer (BLOCK)
- **Select:** `Unknown Contact`
- **Amount:** `₦500,000+`
- **Narration:** `urgent help abeg`
- **Channel:** `USSD`
- **Watch:** Shield intercepts. The risk score spikes to `0.94`. GPT-4o explains exactly why it was blocked.

#### 🛡️ 3. User Overrides (GHOST)
- **Tap:** `Send Anyway → Ghost Protection` (on the blocked screen)
- **Watch:** Funds are routed to a `GhostContainer`. A 15-minute countdown starts, allowing you to cancel safely and retrieve the money.

<br />

---

<div align="center">
  <h3>🏆 Built for HackX 6.0 × Union Bank</h3>
  <p>Designed, architected, and built during an intense 7-day sprint by <b>Team Fable</b>:</p>
  <p>
    <b>Kenzy</b> (Lead Engineer) • 
    <b>Natty / Conqueror909</b> (Backend Engineer) • 
    <b>Blessing / Katalysttt</b> (Frontend Engineer & Product)
  </p>
  <br />
  <p><i>Trust by receipts, not promises.</i></p>
</div>
