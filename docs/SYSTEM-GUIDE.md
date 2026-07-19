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
        ├─ generate API key    →  fable_live_a87c82a4...
        ├─ generate password   →  temp password, hashed
        ├─ register tenant     →  institutions table
        ├─ SEED the tenant     →  3 customers × 90 days of history + threats
        └─ email the admin     →  dashboard login + API key + demo URL
```

The welcome email contains three things:

1. **Dashboard URL** + admin email + temporary password
2. **API key** (`fable_live_...`) — the real integration credential
3. **Demo bank URL** — `/demo/zenith_test_bank`, pre-loaded with customers

Seeding at provisioning time is deliberate: a new tenant logs into a *populated*
console, not an empty one.

### How the demo bank knows which institution it is

Two paths, and the authenticated one always wins:

| Path | Mechanism | Trust |
|---|---|---|
| **URL** | `/demo/zenith_test_bank` — the slug in the path | Asserted, validated against the registry |
| **API key** | "Connect institution" field → `X-API-Key` header on every call | Authenticated |

`api/tenancy.py::resolve_institution` decides: API key → claimed slug → default.
An unknown slug falls back to the default rather than silently creating a
phantom tenant. This is why pasting a Zenith key into a Meridian URL still books
the transfer to Zenith — the key is proof, the URL is just a claim.

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

## 5. Shield's 12 signal layers

Signals are additive. `FLAG` at ≥ 0.5, `BLOCK` at ≥ 0.8.

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
| **Shield** | Scores every transfer through the 12 layers | Writes `transactions` with signals |
| **Ghost** | Holds risky transfers in a recoverable cooling window | `ghost_containers` |
| **Watch** | Continuous monitoring between transactions | Not built — honestly marked "coming soon" |

Each has a dashboard deep-dive at `/dashboard/agents/{agent}`:

- **Copilot** — per-customer baselines, searchable. What Fable knows about whom.
- **Shield** — the 12-layer pipeline with weights, plus recent decisions you can
  expand to see every signal and the device/location/session context behind it.
- **Ghost** — active and historical containers, cancellation rate, money saved.

---

## 7. Why the customer picker matters

Three seeded customers per institution, with deliberately different baselines:

| Customer | Persona | Typical range |
|---|---|---|
| Chioma Nnamdi | Student | ₦1,500 – ₦9,000 |
| Ada Obi | Salaried professional | ₦8,000 – ₦55,000 |
| Tunde Bello | Trader | ₦80,000 – ₦400,000 |

Send **the same ₦250,000** as each (verified):

| Customer | Result | Why |
|---|---|---|
| Tunde | **PASS** 0.24 | Routine for him |
| Ada | **FLAG** 0.564 | 8× her baseline |
| Chioma | **FLAG** 0.552 | 20× her baseline |

Same amount, same recipient, same device — three different verdicts. That is the
entire pitch for per-customer behavioural baselines, and it is the single most
convincing thing to demo.

---

## 8. Multi-tenant isolation

Every transaction and ghost container carries `institution_id`. Every read is
filtered by the institution the console logged in as (`/auth/login` returns it;
it is no longer hardcoded).

Verified: Zenith sees 3 customers / 174 data points; Meridian sees 1 / 46.
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
     -d '{"institution_name":"Zenith Test Bank","admin_email":"risk@zenithtest.ng"}'
   ```

   Note the `demo_url`, `api_key` and `temp_password` from the response.

2. **Open the demo bank** at the returned `demo_url`. Confirm the sidebar shows
   the bank's name and the customer picker lists three people.

3. **Switch to Chioma** (the student). Transfer **₦250,000** to any 10-digit
   account. It should **FLAG**.

4. **Switch to Tunde** (the trader). Send the same ₦250,000. It should **PASS**.
   That contrast is the demo.

5. **Trigger a block:** as Chioma, ₦500,000 over USSD with narration
   `urgent help abeg`, to a new account. Then choose "send anyway" to see Ghost
   hold it, and cancel to recover the money.

6. **Log into the dashboard** with the provisioned email + temp password. You
   should see *only* that bank's transfers.

7. **Open `/dashboard/agents`** → drill into Shield to see your transfer's full
   signal breakdown, and Copilot to see the three customers' baselines.

8. **Prove isolation:** log in as `risk@meridian.ng` / `fable-demo`. Completely
   different numbers.

### Reseed between runs

Test transfers that PASS are learned as legitimate and raise the customer's
baseline — real behaviour, but it drifts the demo. Reset before pitching:

```bash
curl -X POST http://localhost:8000/v1/demo/seed-institution \
  -H "Content-Type: application/json" \
  -d '{"institution_id":"zenith_test_bank","days":90}'
```

---

## 10. Known limits (stated honestly)

- **Watch is not built.** The dashboard marks it "coming soon" rather than
  faking it.
- **GPS has no reverse geocoding.** Coordinates are real; the city label comes
  from the IP lookup, since reverse geocoding needs a paid API.
- **Paystack's IP allowlist rotates.** Dynamic ISP addresses change, so
  `/api/paystack-status` exists to diagnose it in one call.
- **Ghost is simulated containment.** It models the cooling window in SQLite;
  production would wire it to a real Open Banking holds endpoint.
- **`fable.db` is SQLite.** Fine for a demo and for real load in the small; the
  schema deliberately mirrors Postgres so it can be swapped.
