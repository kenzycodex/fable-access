# Fable: How Everything Connects

The complete map of the system — every page, every flow, what talks to what, and
how to test it end to end.

---

## 1. The one-paragraph version

Fable is fraud infrastructure that banks plug into. A bank is **provisioned**
by a Fable operator: it starts empty, its owner sets up the console, an API key
and its customers. Its customers use the bank's own app (or, while testing, the
**sandbox app** at `/demo/{institution}`), which collects real
device, location, session and behavioural data on every transfer. That context
goes to **Shield**, which scores the transfer against **Copilot's** learned
baseline *for that specific customer*. Risky transfers land in **Ghost**, a
cooling window where money is still recoverable. The bank's risk team watches
all of it from the **dashboard**, which only ever shows that bank's own data.

---

## 2. The three surfaces

| Surface | Route | Who uses it |
|---|---|---|
| Marketing site | `/`, `/platform`, `/pricing`, `/why-fable` | Prospects |
| Demo bank (customer app) | `/demo/{institution}` | A bank's end customers |
| Institution console | `/dashboard/*` | The bank's risk/fraud team |

Two runtimes back them:

- **Next.js** (`src/`) — all three surfaces, plus server routes for Paystack
  (`/api/banks`, `/api/resolve-account`, `/api/paystack-status`).
- **FastAPI** (`api/`) — the intelligence layer: Shield, Copilot, Ghost, the
  dashboard aggregations, provisioning, and auth. SQLite (`api/fable.db`).

Every decision is made by the FastAPI service. If it is down, the sandbox app
says so and sends nothing (it never invents a verdict on the device), and the
dashboard shows an offline notice instead of blank panels.

---

## 3. Onboarding flow (the "banks plug in once" story)

```
Fable operator (operator platform, MFA)
  └─ New institution  { name, type, owner email }
        ├─ slugify name        →  "Clearwater MFB" → clearwater_mfb
        ├─ register tenant     →  institutions table, mode = sandbox, EMPTY
        └─ invite the owner    →  one-time set-password link (7 days)

Owner (bank console)
  ├─ Settings > Go live      →  the checklist below, derived from real state
  ├─ API & webhooks           →  create the API key (shown once), add a webhook, test it
  ├─ Risk policy              →  review thresholds and hold windows
  ├─ Data                     →  import customers and past transfers (CSV or API)
  ├─ Team                     →  invite analysts and viewers
  └─ Go live                  →  confirm the DPA and DPIA; refused until required items are done
```

There is no demo data and no default tenant. A new institution is empty until
it imports its own customers. Customers are identified by **the bank's own
reference** (account or CIF number); Fable keeps an internal id per
`(institution, reference)`, so two banks can both have a customer `10293`
without sharing anything.

### The sandbox app

Each institution gets a sandbox banking app at `/demo/<institution>` to try
Fable with its own **test** customers. It needs a console sign-in to that
institution, shows only test customers, and switches off when the institution
goes live. Saved recipients come from each test customer's own history.

### How a request knows its institution

`api/core/tenancy.py` decides which institution a request acts for, from its
credential only: the API key, or the console session. A name in the URL, query
or body is never used, there is no default tenant, and a request with no
credential is a `401`. `customer_guard` checks that every customer, hold and
transaction a request touches belongs to the caller's institution, and answers
`404` otherwise. Cross-institution attempts are written to the audit log, and
operators see them on the operator overview.

---

## 4. What happens on a single transfer

This is the core loop. Every numbered step is real, not simulated.

```
1. A test customer opens the sandbox app, /demo/<institution>
   └─ session.ts starts the banking session (login time, auth method)
      stored in sessionStorage — clears on tab close, like a real bank app

2. Customer taps Transfer
   ├─ fingerprint.ts   → screen, GPU, battery, network, canvas hash
   │                     → stable fingerprint_id that survives refreshes
   ├─ geolocation.ts   → GPS permission prompt; IP fallback (ipapi.co)
   ├─ biometrics.ts    → starts recording typing cadence, pointer, scroll
   └─ channel auto-detected (coarse pointer/viewport → Mobile App, else Web)

3. Customer enters an account number + picks a bank
   └─ /api/resolve-account → Paystack NUBAN lookup → the REAL account holder
      (falls back to a deterministic generator, labelled "simulated")

4. Customer hits Send
   └─ everything collected is bundled and POSTed to /v1/shield/analyze
      along with user_id (the picked customer) and institution_id

5. Shield scores it against the customer's baseline (see §5)
   └─ writes the transaction, tagged with institution_id, plus the device
      profile and location trail

6. Verdict:
   PASS  → completes silently
   FLAG  → user is asked to confirm
   BLOCK → user can override into Ghost

7. Ghost (if used) holds the transfer in a cooling window sized by risk
   (15 min high / 10 med / 5 low by default, set per institution). Cancel =
   the money stays. Release = sent, with stronger proof. Nobody acts = it
   expires and the money stays. Live, the bank keeps the funds during the hold
   and acts on the containment.* webhooks.

8. The bank's dashboard shows it within ~4 seconds (SWR polling),
   and ONLY that bank's dashboard.
```

---

## 5. Shield's signals

Signals are additive. The default cutoffs are `FLAG` at 0.50 and `BLOCK` at 0.80,
adjusted per channel (see the scoring doc), and an institution can move them in
Settings, Risk policy.

| # | Signal | Fires when | Max (default) |
|---|---|---|---|
| 1 | `amount_anomaly` | Far above the customer's own normal, in tiers from 3x to 50x | 0.40 |
| 2 | `cold_start` | Fewer than three past transfers: judged against the institution's customers as a whole | 0.15 |
| 3 | `first_transfer_amount` | No history to compare: the amount itself, in tiers from NGN 100k to NGN 20m | 0.45 |
| 4 | `new_recipient` | First transfer to this account | 0.20 |
| 5 | `time_anomaly` | Outside typical hours, on the **device clock** | 0.12 |
| 6 | `channel_risk` | Channel weights from NIBSS fraud data (internet banking highest, branch lowest) | 0.22 |
| 7 | `nip_code` | NIBSS risk codes from the bank's rail; code 34 always blocks | 0.95 |
| 8 | `scam_pattern` | Narration matches a scam script (halved on purpose) | 0.25 |
| 9 | `ml_anomaly` | The amount and hour together sit far from the customer's own past transfers | 0.10 |
| 10 | `device_anomaly` | Unrecognised device fingerprint, more for a large transfer | 0.18 |
| 11 | `location_anomaly` | New city, or outside home country | 0.22 |
| 12 | `session_freshness` | Large transfer seconds after sign-in | 0.12 |
| 13 | `behavioral_anomaly` | Pasted account number and near-zero hesitation on a large amount | 0.15 |
| 14 | `timezone_mismatch` | Device timezone differs from usual | 0.08 |
| 15 | `failed_verification` | Recent failed PIN, passkey or code attempts | 0.25 |
| 16 | `velocity` | Several live transfers in a few minutes | 0.20 |

A long, confirmed-clean record then subtracts a small `tenure` discount (at most
0.08 by default).

Weights live in governed engine versions. Fable operators change them on the
operator platform's Engine page: a change is drafted, backtested against past
decisions, approved by a second person (or after a cooling-off period when
there is only one owner), can run in shadow, and is then promoted. Every
decision records the version that made it. A value set in the server
environment (`FABLE_W_*`) still overrides the version, and the Engine page says
so.

**Why narration is deliberately weak (`scam_pattern`):** most people leave it
blank. Basing fraud detection on it would be theatre. It contributes when
present, but the device, location, session and behaviour signals carry the
weight because the customer cannot opt out of them.

**The amount scale runs past 10x on purpose.** It used to cap there, which meant
a student sending 45× her normal amount scored *lower* than someone at 8× who
also tripped a time anomaly — and passed. It now escalates through 25× and 50×
tiers.

---

## 6. The agents, and what each actually does

| Agent | Job | Where its data lives |
|---|---|---|
| **Copilot** | Learns each customer's normal: amounts, hours, recipients, devices, cities, session habits | Derived live from `transactions` (90-day window) |
| **Shield** | Scores every transfer against the sixteen signals | Writes `transactions` with signals, score parts and the engine version |
| **Ghost** | Holds risky transfers in a recoverable cooling window | `ghost_containers` |
| **Watch** | Continuous monitoring between transactions | Not built — honestly marked "coming soon" |

Each has a dashboard deep-dive at `/dashboard/agents/{agent}`:

- **Copilot** — per-customer baselines, searchable. What Fable knows about whom.
- **Shield** — the signals with their weights in force, plus recent decisions you can
  expand to see every signal and the device/location/session context behind it.
- **Ghost** — active and historical containers, cancellation rate, money saved.

The rest of the console, in the order a risk team uses it:

- **Overview** — live decisions, money kept from fraud, decision time, and how
  many cases need review.
- **Review queue** — every flagged or blocked transfer is a case. An analyst
  assigns it, adds notes, escalates it, and resolves it as fraud or legitimate.
  This labels the transfer and teaches Copilot; it never moves money, which only
  moves through the customer's own verification or Ghost.
- **Transactions** and **Customers** — the full log with date ranges and CSV
  export, and a profile per customer with their baseline, verification status,
  history and cases.
- **Compliance** — the audit trail, incident log, CSV export and a printable
  board report.
- **Settings** — profile, branding, risk policy, team and roles, API key and
  webhooks.

Roles are enforced by the API: an **owner** can do everything, an **analyst**
works the review queue, a **viewer** can only read.

---

## 7. Why per-customer baselines matter

Each customer is judged against their own history, imported or learned. The
same transfer means different things for different people:

| Profile | Typical range |
|---|---|
| Student | ₦1,500 – ₦9,000 |
| Salaried professional | ₦8,000 – ₦55,000 |
| Trader / business owner | ₦80,000 – ₦400,000 |

Send **the same ₦250,000** to a new recipient on the mobile app as each
(no device or location context):

| Profile | Result | Why |
|---|---|---|
| Trader | **PASS** 0.40 | Routine for them |
| Salaried | **FLAG** 0.76 | Several times their baseline |
| Student | **BLOCK** 0.90 | Roughly fifty times their baseline |

Same amount, same recipient, same device: three different verdicts. To see it,
import three test customers with history shaped like these profiles.

---

## 8. Multi-tenant isolation

Every row belongs to one institution, and only that institution can reach it.
`api/tests/test_tenant_isolation.py` pins the rules: no credential is a `401`;
another bank's customer, hold or transaction is `404`, whatever credential is
used; two banks can share a customer reference without sharing anything; a live
bank's customers are reachable only with its API key; a suspended bank is
refused everywhere. Exports and the audit log a bank sees contain only its own
rows, and operator identities are shown to banks as "Fable".

---

## 9. Testing it end to end

### Start both services

```bash
# API  (from api/)
.venv/Scripts/python -m uvicorn main:app --port 8000

# Frontend (from repo root)
pnpm dev
```

### Check Paystack is genuinely live

```bash
curl -s http://localhost:3000/api/paystack-status
```

`resolve.ok: true` is the one that matters. The bank list can succeed while
resolution is IP-blocked — they are gated separately, which is exactly how a
broken integration hides.

### Full walkthrough

1. **Create an operator** (once): `python scripts/create_operator.py you@company.com "Your Name"`,
   then sign in at `/operator/login` and enrol your authenticator app.
2. **Create an institution** from the operator platform. Open the owner's invite
   link (shown when email is not set up) and choose a password.
3. **Import customers** in the console under **Settings > Data**, from the
   templates. Mark two or three as `test`, with an opening balance, and import
   past transfers for them.
4. **Open the sandbox app** from the console. Pick a test customer and send a
   transfer that is unusual for them: it should FLAG or BLOCK. Choose "send
   anyway" to see Ghost hold it, then cancel to recover the money.
5. **Work the case** in the **Review queue**: assign, note, resolve. **Customers**
   shows each customer's baseline; **Ask Fable** answers from the bank's figures.
6. **Prove isolation:** create a second institution and sign in to it. Completely
   different numbers, and the first bank's cases return 404.
7. **Go live:** finish **Settings > Go live**. The sandbox app switches off and
   customer requests then need the API key.

Passing test transfers teach the baseline, as real ones do. To start a test
again, an owner can reset the sandbox under **Settings > Data**.

---

## 10. Known limits (stated honestly)

- **Watch is not built.** The dashboard marks it "coming soon" rather than
  faking it.
- **Reverse geocoding uses third-party map services.** The device's GPS fix is
  named by the API (Google, LocationIQ or Geoapify when keyed, else
  OpenStreetMap), with browser-side OpenStreetMap and BigDataCloud as the last
  fallback. Customer coordinates therefore leave the origin, which the DPIA
  required under the NDPA 2023 and GAID 2025 has to cover.
- **Paystack's IP allowlist rotates.** Dynamic ISP addresses change, so
  `/api/paystack-status` exists to diagnose it in one call.
- **Ghost does not hold money itself.** It keeps the hold's state and tells
  the bank, by webhook, when to send or return the funds. In the sandbox the
  sandbox ledger stands in for the bank; live, the bank's core banking system
  keeps the funds during the hold.
- **API keys are shown once.** Only a SHA-256 hash of each key is stored, with
  its first and last characters for display, so a copy of the database holds no
  usable key. The full key appears once, when it is issued (provisioning email or
  rotation). A lost key is replaced by rotating it in Settings.
- **Analyst actions label, they do not move money.** Resolving a case as
  legitimate does not release a blocked transfer. Money moves only through the
  customer's own verification, a Ghost release, or a staff release of a hold
  the customer asked the bank to release.
- **There is no cross-institution intelligence.** Each institution's data is
  strictly its own. Sharing hashed signals between banks is on the roadmap, not
  built.
- **`fable.db` is SQLite.** Fine for a demo and for real load in the small; the
  schema deliberately mirrors Postgres, but swapping it requires driver and query
  rewrites, rather than being a drop-in configuration change.

---

## 11. Identity assurance — binding decisions to a real person

Shield answers *how risky is this?*. Assurance answers the question that makes
containment hold: *who must prove they are here, and with what?*

### The hole this closes

Ghost's release path checked only that the caller claimed to be the account
holder — and the client supplies that id about itself. So containment was
defeated by the exact session compromise that triggered it: an attacker holding
the tab could press "release" and Fable would hand over the money, with every
behavioural signal having correctly fired.

**Releasing now costs proof. Cancelling stays free**, because returning money is
always safe.

### Why the factor's location matters more than its type

A PIN prompt inside a compromised session is theatre — the attacker has that
prompt too. Only two kinds of factor cost an attacker anything:

| Kind | Example | Why it holds |
|---|---|---|
| **Device-bound** | Passkey / platform biometric | Private key is generated in the secure element and never leaves it. Holding the session ≠ holding the key. |
| **Out-of-band** | Code to the confirmed email or phone | Arrives on a channel the session doesn't control. |

### The tiers, and the escalation rule

| Container held because of | Release demands |
|---|---|
| Amount alone (risk 0.55) | `passkey` |
| Amount **+ device + location anomaly** (risk 0.88) | `identity_check` |

The escalation is the point: risk arising from *identity* signals implies the
session may not belong to the customer, so those cases jump to a factor the
session cannot satisfy — rather than asking for one more thing the attacker
already has. Release is always at least one tier above the transfer itself.

### What's real here

- **Passkeys** — genuine WebAuthn, signatures verified with `py_webauthn`. Real
  Face ID / Touch ID / Windows Hello.
- **One-time codes** — real, by email over the configured SMTP, or by SMS
  through Termii or Africa's Talking when configured. A phone is used only
  once the customer confirms it. Codes are stored hashed and compared in
  constant time. Sandbox codes go to the sandbox inbox, never to a real address.
- **The top tier** (`identity_check`) is passkey, code and PIN together, while
  there is no liveness provider.
- **Face / liveness** — planned, **not** implemented. Returns `501` with the
  provider contract (Smile ID / Youverify / Dojah / Prembly). Faking it would
  make the strongest tier the least trustworthy.
- **Only factors set up before the decision count**, so someone who has just
  taken over an account cannot add their own device and release a hold.

Challenges and tokens are single-use, expiring, and bound to a user, a purpose
and a reference — proof minted for a small transfer cannot be replayed against
a large one. Verified: wrong reference, wrong purpose, wrong user and replayed
tokens are all refused.

### The feedback loop

`previous_failed_attempts` had sat unused in the schema since it was added.
Failed factor attempts are now recorded and read back as the
`failed_verification` scoring signal —
three failed biometrics before a large transfer is about the clearest evidence
available.

### Why this improves rather than replaces

Banks already own PIN, biometric, OTP and BVN-linked face data. What nobody
does well is decide *when* to demand which; today it's a static rule ("OTP above
₦100k"), which is exactly why scammers coach victims through OTPs — the
threshold is predictable. Fable makes the demand behaviourally driven and
unpredictable to the attacker: the same ₦50,000 that clears silently for Tunde
forces a stronger factor for Chioma from a new device in a new city. The bank
keeps its auth stack; Fable decides the moment.
