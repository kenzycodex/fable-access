# Fable: How Everything Connects

The complete map of the system — every page, every flow, what talks to what, and
how to test it end to end.

---

## 1. The one-paragraph version

Fable is fraud infrastructure that banks plug into. A bank is **provisioned**
(gets a dashboard login, an API key, and its own demo bank URL). Its customers
use a **banking app** (`/demo/{institution}`), which silently collects real
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

The frontend degrades gracefully: if the FastAPI service is down, the demo falls
back to a local scoring engine (`src/lib/fable/scoring.ts`) so it never breaks
mid-pitch. The dashboard shows an offline notice instead of blank panels.

---

## 3. Onboarding flow (the "banks plug in once" story)

```
POST /admin/provision  { institution_name, admin_email }
        │
        ├─ slugify name        →  "Zenith Test Bank" → zenith_test_bank
        ├─ generate API key    →  fbl_live_da3c8f21...
        ├─ generate password   →  temp password, hashed
        ├─ register tenant     →  institutions table
        ├─ SEED the tenant     →  2 customers × 90 days of history + threats
        └─ email the admin     →  dashboard login + API key + demo URL
```

Provisioning is an operator action, not a public endpoint: it needs the
`X-Fable-Operator-Key` header, and is switched off when no operator key is set.
Customer ids are the institution id plus the customer's first name
(`zenith_test_bank_segun`). Each institution gets different people, but always
the same two profiles, a trader and a student (`FABLE_DEMO_CUSTOMERS=3` adds a
salaried one).

The welcome email contains three things:

1. **Dashboard URL** + admin email + temporary password
2. **API key** (`fbl_live_...`) — the real integration credential
3. **Demo bank URL** — `/demo/zenith_test_bank`, pre-loaded with customers

Seeding at provisioning time is deliberate: a new tenant logs into a *populated*
console, not an empty one.

### How the demo bank knows which institution it is

Two paths, and the authenticated one always wins:

| Path | Mechanism | Trust |
|---|---|---|
| **URL** | `/demo/zenith_test_bank` — the slug in the path | Asserted, validated against the registry |
| **API key** | "Connect institution" field → `X-API-Key` header on every call | Authenticated |

`api/core/tenancy.py::resolve_institution` decides: API key → claimed slug → the
only institution, when exactly one exists. There is no default tenant: with
several institutions and nothing naming one, the request is refused (400)
rather than guessed, and an unknown slug never creates a phantom tenant. This is
why pasting a Zenith key into a Meridian URL still books the transfer to Zenith:
the key is proof, the URL is just a claim.

---

## 4. What happens on a single transfer

This is the core loop. Every numbered step is real, not simulated.

```
1. Customer opens /demo/zenith_test_bank
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

5. Shield scores it through 12 signal layers (see §5)
   └─ writes the transaction, tagged with institution_id, plus the device
      profile and location trail

6. Verdict:
   PASS  → completes silently
   FLAG  → user is asked to confirm
   BLOCK → user can override into Ghost

7. Ghost (if used) holds the money in a cooling window sized by risk
   (30 min high / 15 med / 5 low). Cancel = money back. Confirm = released.

8. The bank's dashboard shows it within ~4 seconds (SWR polling),
   and ONLY that bank's dashboard.
```

---

## 5. Shield's 14 signal layers

Signals are additive. The default cutoffs are `FLAG` at 0.50 and `BLOCK` at 0.80,
adjusted per channel (see the scoring doc), and an institution can move them in
Settings, Risk policy.

| # | Signal | Fires when | Max |
|---|---|---|---|
| 1 | `amount_anomaly` | Amount far above the customer's own average | 0.40 |
| 2 | `new_recipient` | First transfer to this account | 0.20 |
| 3 | `time_anomaly` | Outside typical hours (**device clock**, not server UTC) | 0.12 |
| 4 | `channel_risk` | NIBSS channel weights (USSD highest) | 0.25 |
| 5 | `nip_code` | NIBSS instant-payment risk codes (34 = auto-block) | 0.95 |
| 6 | `scam_pattern` | Narration matches a scam script — **halved on purpose** | 0.25 |
| 7 | `ml_anomaly` | Isolation Forest deviation from own history | 0.15 |
| 8 | `device_anomaly` | Unrecognised fingerprint (scales with amount) | 0.18 |
| 9 | `location_anomaly` | New city, or outside home country | 0.22 |
| 10 | `session_freshness` | Large transfer within 30s of login | 0.12 |
| 11 | `behavioral_anomaly` | Pasted account number + near-zero hesitation | 0.15 |
| 12 | `timezone_mismatch` | Device timezone ≠ usual timezone | 0.08 |
| 13 | `failed_verification` | Recent failed identity checks | 0.25 |
| 14 | `velocity` | A burst of transfers in a short window | 0.20 |

**Why narration is deliberately weak (layer 6):** most people leave it blank.
Basing fraud detection on it would be theatre. It contributes when present, but
layers 8–12 carry the weight because the customer cannot opt out of them.

**The amount scale runs past 10x on purpose.** It used to cap there, which meant
a student sending 45× her normal amount scored *lower* than someone at 8× who
also tripped a time anomaly — and passed. It now escalates through 25× and 50×
tiers.

---

## 6. The agents, and what each actually does

| Agent | Job | Where its data lives |
|---|---|---|
| **Copilot** | Learns each customer's normal: amounts, hours, recipients, devices, cities, session habits | Derived live from `transactions` (90-day window) |
| **Shield** | Scores every transfer through the 14 layers | Writes `transactions` with signals |
| **Ghost** | Holds risky transfers in a recoverable cooling window | `ghost_containers` |
| **Watch** | Continuous monitoring between transactions | Not built — honestly marked "coming soon" |

Each has a dashboard deep-dive at `/dashboard/agents/{agent}`:

- **Copilot** — per-customer baselines, searchable. What Fable knows about whom.
- **Shield** — the 14-layer pipeline with weights, plus recent decisions you can
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

## 7. Why the customer picker matters

Two seeded customers per institution (three with `FABLE_DEMO_CUSTOMERS=3`), with
deliberately different baselines. The names change from one institution to the
next; the profiles do not:

| Profile | Typical range |
|---|---|
| Student | ₦1,500 – ₦9,000 |
| Salaried professional (the optional third) | ₦8,000 – ₦55,000 |
| Trader / business owner | ₦80,000 – ₦400,000 |

Send **the same ₦250,000** to a new recipient on the mobile app as each
(measured with the current engine, with no device or location context, so a
real session moves the scores slightly):

| Profile | Result | Why |
|---|---|---|
| Trader | **PASS** 0.40 | Routine for them |
| Salaried | **FLAG** 0.76 | Several times their baseline |
| Student | **BLOCK** 0.90 | Roughly fifty times their baseline |

Same amount, same recipient, same device: three different verdicts. That is the
entire pitch for per-customer behavioural baselines, and it is the single most
convincing thing to demo.

---

## 8. Multi-tenant isolation

Every transaction and ghost container carries `institution_id`. Every read is
filtered by the institution the console logged in as (`/auth/login` returns it;
it is no longer hardcoded).

This is covered by tests: a session for one institution gets a 404 on another's cases and customers, its exports contain only its own rows, and a removed team member loses access on their next request.
Neither can see the other.

Data that predates multi-tenancy was migrated and backfilled to `meridian`, so
nothing was orphaned.

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

1. **Provision a bank**

   ```bash
   curl -X POST http://localhost:8000/admin/provision \
     -H "Content-Type: application/json" \
     -H "X-Fable-Operator-Key: $FABLE_OPERATOR_KEY" \
     -d '{"institution_name":"Zenith Test Bank","admin_email":"risk@zenithtest.ng"}'
   ```

   Note the `demo_url`, `api_key` and `temp_password` from the response.

2. **Open the demo bank** at the returned `demo_url`. Confirm the sidebar shows
   the bank's name and the customer picker lists two people.

3. **Switch to the student.** Transfer **₦250,000** to any 10-digit
   account. It should **BLOCK**.

4. **Switch to the trader.** Send the same ₦250,000. It should **PASS**.
   That contrast is the demo.

5. **Trigger a block:** as the student, ₦500,000 over USSD with narration
   `urgent help abeg`, to a new account. Then choose "send anyway" to see Ghost
   hold it, and cancel to recover the money.

6. **Log into the dashboard** with the provisioned email + temp password. You
   should see *only* that bank's transfers.

7. **Open the console.** The **Review queue** now holds the blocked transfer:
   assign it to yourself, add a note, and resolve it. **Agents, Shield** shows
   its full signal breakdown, and **Customers** shows each customer's baseline.

8. **Prove isolation:** provision a second bank and sign in as its admin.
   Completely different numbers, and the first bank's cases return 404.

### Reseed between runs

Test transfers that PASS are learned as legitimate and raise the customer's
baseline — real behaviour, but it drifts the demo. Reset before pitching:

```bash
curl -X POST http://localhost:8000/v1/demo/seed-institution \
  -H "Content-Type: application/json" \
  -H "X-Fable-Operator-Key: $FABLE_OPERATOR_KEY" \
  -d '{"institution_id":"zenith_test_bank","days":90}'
```

---

## 10. Known limits (stated honestly)

- **Watch is not built.** The dashboard marks it "coming soon" rather than
  faking it.
- **GPS reverse geocoding uses free providers.** Coordinates are real and the
  place name comes from Nominatim, falling back to BigDataCloud and then to the
  IP lookup. Customer coordinates therefore leave the origin, which is an NDPR
  consideration that has not been formally assessed.
- **Paystack's IP allowlist rotates.** Dynamic ISP addresses change, so
  `/api/paystack-status` exists to diagnose it in one call.
- **Ghost is simulated containment.** It models the cooling window in SQLite;
  production would wire it to a real Open Banking holds endpoint.
- **API keys are shown once.** Only a SHA-256 hash of each key is stored, with
  its first and last characters for display, so a copy of the database holds no
  usable key. The full key appears once, when it is issued (provisioning email or
  rotation). A lost key is replaced by rotating it in Settings.
- **Analyst actions label, they do not move money.** Resolving a case as
  legitimate does not release a blocked transfer. Money moves only through the
  customer's own verification or a Ghost release.
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
the tab could press "release" and Fable would hand over the money, with all
twelve behavioural layers having correctly fired.

**Releasing now costs proof. Cancelling stays free**, because returning money is
always safe.

### Why the factor's location matters more than its type

A PIN prompt inside a compromised session is theatre — the attacker has that
prompt too. Only two kinds of factor cost an attacker anything:

| Kind | Example | Why it holds |
|---|---|---|
| **Device-bound** | Passkey / platform biometric | Private key is generated in the secure element and never leaves it. Holding the session ≠ holding the key. |
| **Out-of-band** | Code to the registered address | Arrives on a channel the session doesn't control. |

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
- **Email OTP** — real, over the configured SMTP. Codes are stored hashed and
  compared in constant time.
- **Face / liveness** — deliberately **not** implemented. Returns `501` with the
  provider contract (Smile ID / Dojah / Prembly). Faking it would make the
  strongest tier the least trustworthy.

Challenges and tokens are single-use, expiring, and bound to a user, a purpose
and a reference — proof minted for a small transfer cannot be replayed against
a large one. Verified: wrong reference, wrong purpose, wrong user and replayed
tokens are all refused.

### The feedback loop

`previous_failed_attempts` had sat unused in the schema since it was added.
Failed factor attempts are now recorded and read back as scoring signal #13 —
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
