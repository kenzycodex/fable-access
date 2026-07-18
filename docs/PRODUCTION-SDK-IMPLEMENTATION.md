# Fable Production SDK Implementation

This document is the complete implementation spec for turning Fable's demo into a real,
data-collecting behavioral intelligence platform. Every piece of context a real bank SDK
would collect, Fable now collects for real: device, location, session, behavioral
biometrics, and real account resolution. Nothing here is simulated unless the real source
is unavailable, in which case the system degrades gracefully instead of breaking.

---

## 1. Architecture Overview

```
Browser (demo bank, /demo/transfer)
 ├─ fingerprint.ts   → real device fingerprint (screen, GPU, battery, network, canvas hash)
 ├─ geolocation.ts   → GPS (permission-based) with IP-geolocation fallback
 ├─ session.ts       → login timestamp, auth method, session duration (sessionStorage)
 ├─ biometrics.ts    → typing cadence, pointer velocity, paste detection, time-to-submit
 └─ api.ts           → bundles ALL of the above into POST /v1/shield/analyze
        │
        ▼
Next.js API routes (server side)
 ├─ /api/banks            → real Paystack bank list (cached in memory)
 └─ /api/resolve-account  → real Paystack NUBAN resolution (fallback: deterministic names)
        │
        ▼
FastAPI backend (api/)
 ├─ models/schemas.py     → expanded Device + Context models (all new fields)
 ├─ db.py                 → migrated transactions table + device_profiles + user_locations
 ├─ agents/shield/analyzer.py → 12-signal scoring pipeline
 ├─ agents/copilot/baseline.py → baseline now includes devices, cities, session stats
 └─ routers/agents.py     → agent-level analytics for the institution dashboard
        │
        ▼
Institution dashboard (/dashboard/agents)
 ├─ Overview: all 4 agents as live cards
 ├─ /agents/copilot  → per-customer baselines, data freshness
 ├─ /agents/shield   → 12-signal pipeline, recent decisions, thresholds
 └─ /agents/ghost    → containers, cancellation rate, money saved
```

## 2. Component 1 — Real Paystack Account Resolution

**Files:** `src/lib/paystack.ts` (new), `src/app/api/banks/route.ts` (new),
`src/app/api/resolve-account/route.ts` (rewritten), `src/app/demo/transfer/page.tsx`,
`.env.local` (new), `api/.env` (`PAYSTACK_SECRET_KEY` already present).

- `GET https://api.paystack.co/bank?country=nigeria` fetches the real bank list with
  NUBAN codes. Cached in module memory for 12 hours (the list rarely changes).
- `GET https://api.paystack.co/bank/resolve?account_number=…&bank_code=…` resolves the
  real account holder name. Free on test keys; no charges.
- The transfer page fetches `/api/banks` on mount. With a key configured the dropdown
  shows the full real bank list; without one it shows a built-in fallback list of the 9
  major banks with their real NUBAN codes, and resolution falls back to the deterministic
  name generator, so the demo never breaks.
- Responses include `"source": "paystack" | "simulated"` so the UI can prove which path ran.

**Getting a key (free):** sign up at dashboard.paystack.com → Settings → API Keys &
Webhooks → copy the Test Secret Key (`sk_test_…`) → paste into `.env.local` at the repo
root as `PAYSTACK_SECRET_KEY=sk_test_…` → restart `pnpm dev`. That's the only step.

## 3. Component 2 — Device Fingerprinting SDK (`src/lib/fable/fingerprint.ts`)

Zero-dependency collector, all real browser APIs:

| Category | Fields | Source |
|---|---|---|
| Screen | width, height, color depth, pixel ratio, orientation | `window.screen` |
| Platform | OS, browser, user agent, platform | `navigator.userAgent` parsing |
| Hardware | CPU cores, device memory (GB), GPU renderer | `hardwareConcurrency`, `deviceMemory`, WebGL `UNMASKED_RENDERER_WEBGL` |
| Locale | language, timezone, tz offset | `Intl.DateTimeFormat` |
| Capabilities | touch support, max touch points, cookies, do-not-track | `navigator` |
| Battery | level, charging | Battery Status API (Chrome; null elsewhere) |
| Network | connection type, downlink, RTT | Network Information API |
| Canvas | deterministic canvas render hash | offscreen `<canvas>` |

A stable `fingerprint_id` (`fp_` + 16 hex chars) is derived by FNV-1a hashing the stable
subset (screen, platform, GPU, language, timezone, canvas hash) — volatile values like
battery level are excluded so the ID survives refreshes. The full snapshot is sent to
Shield on every transfer; the backend upserts it into `device_profiles`.

## 4. Component 3 — Geolocation (`src/lib/fable/geolocation.ts`)

1. **GPS first:** `navigator.geolocation.getCurrentPosition` (8s timeout). The browser
   shows the real permission prompt, exactly like a bank app would.
2. **IP fallback:** `https://ipapi.co/json/` (free, 1000 req/day, no key) when GPS is
   denied, unavailable, or times out. Also supplies the public IP that is forwarded to
   the backend as `device.ip`.
3. Result `{ latitude, longitude, city, region, country, source: "gps"|"ip", ip? }` is
   cached for 5 minutes. Collection starts at page mount and never blocks submission —
   if nothing has resolved by submit time, Shield scores without location and says so.
4. GPS coordinates get city/country attached from the IP lookup when available (browser
   GPS has no reverse geocoding without a paid API; the IP city is the best free label).

## 5. Component 4 — Session & Behavioral Tracking

**`src/lib/fable/session.ts`** — starts a session the first time any `/demo` surface
loads (the demo bank has no separate login screen, so first visit = login). Stored in
`sessionStorage` (clears on tab close, like a real banking session):
`{ loginTimestamp, authMethod: "biometric"|"pin"|"password", previousFailedAttempts }`.
Auth method is picked deterministically per session (weighted toward biometric, like
real mobile banking) and surfaced in the transfer page's data panel.
`getSessionContext()` computes live `session_duration_seconds` at call time.

**`src/lib/fable/biometrics.ts`** — a passive tracker instantiated on the transfer page:

- `attachField(el, name)` on the amount/account/narration inputs → per-field keypress
  intervals (typing cadence in ms) and paste detection (`paste` event + heuristic jumps).
- Pointer velocity from sampled `pointermove` deltas; scroll velocity + direction changes.
- `time_to_first_input` and `time_to_submit` from page-mount timestamps.
- `snapshot()` returns a `BehavioralProfile`; nothing leaves the page until submit.

## 6. Component 5 — Enhanced Shield Scoring (12 signals)

`api/models/schemas.py` gains all new `Device` and `Context` fields (screen, platform,
GPU, battery, network, lat/lng, city, country, location_source, auth_method,
login_timestamp, typing_speed_ms, paste_detected, time_to_submit_seconds,
client_timestamp, client_timezone). All optional — old SDK payloads keep working.

`api/agents/shield/analyzer.py` pipeline:

| # | Signal | Logic | Max boost |
|---|---|---|---|
| 1 | `amount_anomaly` | progressive vs personal baseline (3x/5x/10x) | 0.25 |
| 2 | `new_recipient` | account not in 90-day history | 0.20 |
| 3 | `time_anomaly` | **client device local hour** (falls back to server UTC) outside typical hours | 0.12 |
| 4 | `channel_risk` | NIBSS channel weights | 0.25 |
| 5 | `nip_code` | NIP response codes (34 = hard block) | 0.95 |
| 6 | `scam_pattern` | narration matcher, **de-prioritized ×0.5** (most users skip narration) | ~0.25 |
| 7 | `ml_anomaly` | Isolation Forest on own history | ~0.15 |
| 8 | `device_anomaly` | fingerprint not in known devices; boost scales with amount | 0.18 |
| 9 | `location_anomaly` | city ≠ any known city; foreign country vs. baseline is stronger | 0.22 |
| 10 | `session_freshness` | login-to-transfer < 30s (fresh session) on a large amount | 0.12 |
| 11 | `behavioral_anomaly` | pasted account number + near-zero hesitation + large amount | 0.15 |
| 12 | `timezone_mismatch` | device timezone disagrees with baseline timezone | 0.08 |

Narration de-prioritization: pattern `risk_weight` is multiplied by `NARRATION_WEIGHT_SCALE
= 0.5`, so the strongest script match adds ~0.25 instead of 0.5. The behavioral/device/
location layers replace that lost weight with signals users can't simply not type.

`api/agents/copilot/baseline.py` now also derives: `known_devices` (all fingerprints),
`known_cities`, `home_country`, `typical_timezone`, `avg_session_duration`, and
`avg_time_to_submit` from the new columns.

## 7. Component 6 — Transfer Page Integration

- Channel auto-detected at mount (coarse pointer / touch + viewport ⇒ Mobile App, else
  Desktop/Web) and pre-selected; the selector stays visible for scenario testing, with an
  "auto" badge on the detected one.
- All four collectors start at mount; GPS permission is requested immediately.
- A live "Fable is watching" panel shows exactly what has been collected (device id,
  location + source, session age + auth method, typing/paste stats) — the educational
  proof that this is real data, not simulation.
- On submit the full bundle goes to `shieldAnalyze(input, collected)`; client timestamp +
  timezone ride along so time anomaly uses device-local time.

## 8. Component 7 — Database Schema

`api/db.py` gains a lightweight migration step (`_migrate()`): `PRAGMA table_info` diff +
`ALTER TABLE ADD COLUMN` for each missing column, so existing `fable.db` files upgrade in
place on boot. New `transactions` columns: `client_ip, latitude, longitude, city, country,
location_source, session_duration_seconds, auth_method, typing_speed_ms, paste_detected,
time_to_submit_seconds, client_timestamp, client_timezone`. New tables `device_profiles`
(fingerprint → user, platform, screen, GPU, trust score, first/last seen) and
`user_locations` (per-transfer location trail).

## 9. Component 8 — Agents Dashboard

`api/routers/agents.py` (registered in `main.py`):

- `GET /v1/agents/overview` — live stats for all four agents in one call.
- `GET /v1/agents/copilot/customers` — per-customer baselines (range, hours, recipients,
  devices, cities, data freshness, live vs seed counts).
- `GET /v1/agents/shield/decisions?limit=` — recent decisions with parsed signal
  breakdowns + pipeline metadata (all 12 layers with weights) + accuracy proxies.
- `GET /v1/agents/ghost/containers` — container history, cancellation rate, money saved,
  cooling-window config.

Frontend: `/dashboard/agents` overview (4 cards, Watch marked "coming soon"), deep-dive
pages for Copilot (per-customer table + search), Shield (12-layer pipeline visualization,
recent decisions with expandable signals, thresholds), Ghost (active + historical
containers, money saved). "Agents" added to the sidebar nav. All pages read the live API
with SWR and degrade to a friendly empty state when the API is down.

## 10. Environment

| Var | Where | Purpose |
|---|---|---|
| `PAYSTACK_SECRET_KEY` | `.env.local` (repo root, Next.js) | real account resolution + bank list |
| `PAYSTACK_SECRET_KEY` | `api/.env` | same key, available to the FastAPI side if needed |
| `NEXT_PUBLIC_FABLE_API_URL` | `.env.local` | point the frontend at a deployed API |

`.env.local` is gitignored; a placeholder is created with instructions.

## 11. Privacy Posture

Real collection demands the honest disclosures the demo already makes on the
transparency screen: coordinates are stored, coarse city/country is what scoring uses;
PCI fields are stripped before processing; nothing is sold or shared. The "Fable is
watching" panel makes collection visible instead of silent — in production the same
disclosure lives in the bank's privacy policy.

## 12. Verification

1. `uvicorn main:app` in `api/` + `pnpm dev` → make a transfer → response contains
   device/location/session/behavioral signals; SQLite rows show the new columns filled.
2. Deny GPS → location falls back to `"ip"` source; allow GPS → `"gps"`.
3. Refresh the page twice → same `fingerprint_id` (stable hash).
4. Paste an account number + submit instantly with a big amount → `behavioral_anomaly`
   fires. Transfer from a fresh tab within 30s → `session_freshness` fires.
5. With a Paystack test key set, a real account number + bank resolves to the real
   account holder's name (`"source": "paystack"`).
6. `/dashboard/agents` shows live counts; each deep-dive renders real rows from SQLite.
