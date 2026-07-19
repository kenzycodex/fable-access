# Deploying Fable

The frontend is already live on Vercel at **fablehq.vercel.app**. What's
missing is the backend, a database, and the wiring between them. This is the
full path from there to a working system.

**Current state:** Vercel serves the marketing site, the demo bank and the
console. Every call to the FastAPI service fails, so the app silently falls
back to its local scoring engine. Visitors see a UI with no intelligence
behind it.

---

## 1. What has to exist

| Piece | Where | Why |
|---|---|---|
| Next.js frontend | Vercel (done) | Three surfaces |
| FastAPI backend | **Railway** | Shield, Copilot, Ghost, auth |
| Persistent storage | **Railway volume** | Survives redeploys |
| Paystack key | Vercel env | Real NUBAN resolution |
| SMTP | Railway env | Provisioning + OTP mail |

**Why not Vercel for the backend.** The API is a long-lived FastAPI service
with a database connection and background work. Vercel's functions are
stateless and short-lived, and its filesystem is wiped on every deploy.
Railway runs it as a real process.

---

## 2. Storage: read this before choosing Postgres

`api/fable.db` works locally because the file persists. On Railway the
container filesystem is **ephemeral** — every redeploy wipes it. Without
persistent storage you lose every provisioned institution, transaction,
passkey and branding change.

**Postgres is not a configuration change.** The backend is written against
SQLite, not against a generic SQL layer:

| | Current | Postgres needs |
|---|---|---|
| Driver | `import sqlite3` | `psycopg` |
| Placeholders | `?` | `%s` |
| Timestamps | `datetime('now')` | `NOW()` |
| Auto ids | `AUTOINCREMENT` | `SERIAL` / `IDENTITY` |
| Upserts | `INSERT OR IGNORE` / `OR REPLACE` | `ON CONFLICT` |

Those appear across `db.py`, `branding.py`, and the `admin`, `auth` and `demo`
routers. Porting is real work — a driver swap, a placeholder conversion, and
rewriting the SQLite-only SQL — not an environment variable.

### Recommended now: Railway volume + SQLite

Zero code changes, and a Railway volume **does** persist across redeploys,
which is the property that actually matters here.

1. Railway service → **Settings → Volumes → New Volume**
2. Mount path: `/data`
3. Add `FABLE_DB_PATH=/data/fable.db`

Limits worth knowing: single writer, and it will not scale past one instance.
For a demo, a pitch, and early pilot traffic that is genuinely fine.

### Later: the Postgres port

Do this when you need concurrent writers or more than one instance. Scope:
swap the driver, convert placeholders, replace the five SQLite-only
constructs above, and keep `_migrate()` working. Budget a focused session,
not a deploy-day change.

---

## 3. Deploy the backend (Railway)

### 3.1 Create the service

1. [railway.app](https://railway.app) → **New Project** → **Deploy from GitHub** → `kenzycodex/Fable`
2. Settings → **Root Directory**: `api`
3. Settings → **Start Command**:
   ```
   uvicorn main:app --host 0.0.0.0 --port $PORT
   ```
   `$PORT` is injected by Railway. Binding `0.0.0.0` matters — `127.0.0.1`
   only accepts connections from inside the container and the health check
   will fail.

### 3.2 Add the volume

**Settings → Volumes → New Volume**, mount at `/data`. This is what survives
redeploys; without it the database is gone on every push.

### 3.3 Environment variables

```bash
ENVIRONMENT=production
FRONTEND_URL=https://fablehq.vercel.app

# Points the database at the mounted volume. Without this it lands on the
# container filesystem and is wiped on every redeploy.
FABLE_DB_PATH=/data/fable.db

# CORS — the browser calls this API directly from the Vercel origin.
# Do not leave this as "*" in production.
FABLE_CORS_ORIGINS=https://fablehq.vercel.app

# WebAuthn. RP ID is the bare domain, no scheme or port, and it MUST match
# the site the browser is on or every passkey silently fails to verify.
WEBAUTHN_RP_ID=fablehq.vercel.app
WEBAUTHN_ORIGINS=https://fablehq.vercel.app

# AI explanations (at least one; without either, Shield still scores and
# falls back to a deterministic explanation)
OPENAI_API_KEY=sk-...
ANTHROPIC_API_KEY=sk-ant-...

# Provisioning + step-up email
SMTP_SERVER=smtp.gmail.com
SMTP_PORT=587
SMTP_USERNAME=you@gmail.com
SMTP_PASSWORD=your-app-password
SMTP_FROM=Fable <no-reply@fablehq.app>

BRANDING_SLUG_LOCK_DAYS=7
```

> **Note on `FABLE_API_KEYS`:** leaving it unset disables API-key auth
> entirely, which is how the demo works with zero setup. That means anyone can
> call your production API. Acceptable for a hackathon; set it before anything
> real.

### 3.4 Verify

```bash
curl https://<your-app>.up.railway.app/health
```

Expect `"status":"ok"` and the router list.

---

## 4. Point the frontend at it

In Vercel → your project → **Settings → Environment Variables**:

```bash
NEXT_PUBLIC_FABLE_API_URL=https://<your-app>.up.railway.app
PAYSTACK_SECRET_KEY=sk_test_...
```

`NEXT_PUBLIC_` is required — without the prefix the value never reaches the
browser, and the demo bank is what calls the API.

**Redeploy after setting them.** `NEXT_PUBLIC_*` values are inlined at build
time, so an existing deployment will keep using the old value.

---

## 5. Move the local database up

You asked about using the current local DB as the starting point. Worth being
precise about what's in it: three institutions, their customers, ~90 days of
seeded history, branding, and API keys.

### Option A — reseed on the server (cleanest)

Nothing to migrate. Provision fresh and let the seeder run:

```bash
curl -X POST https://<your-app>.up.railway.app/admin/provision \
  -H "Content-Type: application/json" \
  -d '{"institution_name":"Meridian MFB","admin_email":"risk@meridian.ng"}'
```

Each provision creates the tenant, its customers and 90 days of history. This
is what I'd do: the local DB's history is generated anyway, so copying it
carries no information that reseeding doesn't reproduce.

### Option B — carry the local data across

Only worth it if you've made transfers you want to keep.

```bash
# From the repo root, with the venv active
python api/scripts/export_db.py > fable_dump.sql
```

Staying on SQLite, the simplest move is to copy the file straight onto the
volume — no conversion needed:

```bash
railway run --service <name> -- bash -c "cat > /data/fable.db" < api/fable.db
```

The export script above exists for the eventual Postgres port: `sqlite3 .dump`
emits SQLite-flavoured SQL that Postgres rejects, so it walks the data and
writes plain INSERTs instead.

⚠️ **Passkeys will not survive**, whichever option you pick. A credential is
bound to the Relying Party ID it was registered against, so anything enrolled
on `localhost` is invalid on `fablehq.vercel.app`. Customers re-enrol on first
step-up. This is WebAuthn working correctly, not a bug.

---

## 6. Post-deploy checklist

```bash
API=https://<your-app>.up.railway.app

# Backend alive
curl -s $API/health

# Paystack reachable from Vercel (not from your laptop)
curl -s https://fablehq.vercel.app/api/paystack-status

# Tenant isolation still holds
curl -s "$API/v1/agents/overview?institution=meridian"
```

In the browser:

- [ ] `/demo/meridian` loads with the tenant's own branding
- [ ] Console login at `/dashboard/login` works
- [ ] A transfer appears in the console within ~4 seconds
- [ ] `/dashboard/settings` shows the institution's real API key
- [ ] Passkey enrolment prompts (needs HTTPS — it will not work over plain HTTP)

---

## 7. Things that will bite you

**Paystack IP allowlist.** Railway's egress IP is not your laptop's, and
Paystack enforces the allowlist per endpoint — `/bank` can succeed while
`/bank/resolve` is refused, which makes a broken integration look healthy.
Clear the Test IP box in the Paystack dashboard, or add Railway's egress IP.
`/api/paystack-status` diagnoses this in one call.

**Paystack test-mode daily limit.** A test key allows only **three live bank
resolutions per day**. Past that the API returns 429 and resolution falls back
to generated names — which looks like broken code but is a hard limit on
Paystack's side. `/api/paystack-status` reports it as `rate_limited`. Going to
live mode lifts it, at real cost per lookup.

**CORS.** `FABLE_CORS_ORIGINS=*` and credentials cannot both be set; the code
already disables credentials when origins is `*`. Set the real origin.

**WebAuthn RP ID.** Must be the registrable domain with no scheme or port. A
mismatch fails at verification time, not registration, so it looks like a
signature problem rather than config.

**Cold starts.** Railway's free tier sleeps. First request after idle takes
several seconds and the frontend's 8s timeout may fire, showing the offline
fallback. Hit `/health` before demoing.

**Seed drift.** Passing transfers are learned as legitimate and shift
baselines, so a demo gets duller the more you rehearse. Reset before pitching:

```bash
curl -X POST $API/v1/demo/seed-institution \
  -H "Content-Type: application/json" \
  -d '{"institution_id":"meridian","days":90}'
```

---

## 8. Rough costs

| Service | Tier | Cost |
|---|---|---|
| Vercel | Hobby | Free |
| Railway | Starter | ~$5/mo credit, enough for this |
| Railway volume | Included | Within the same credit |
| Paystack | Test mode | Free |
| OpenAI | Pay-as-you-go | Cents at demo volume |

---

## 9. Order of operations

1. Railway project, root `api`, start command set
2. Add a volume at `/data`
3. Set backend env vars, including `FABLE_DB_PATH=/data/fable.db` → deploy → `curl /health`
4. Set `NEXT_PUBLIC_FABLE_API_URL` + `PAYSTACK_SECRET_KEY` on Vercel → **redeploy**
5. Provision institutions against the live API
6. Add Railway's egress IP to Paystack, or clear the allowlist
7. Walk the checklist in §6
