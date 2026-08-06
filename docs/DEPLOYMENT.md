# Deploying Fable

The frontend is already live on Vercel at **fablehq.vercel.app**. What's
missing is the backend, a database, and the wiring between them. This is the
full path from there to a working system.

**Current state:** Vercel serves the marketing site, the demo bank and the
console. The FastAPI service runs in Docker on a DigitalOcean droplet behind
Nginx. If the API is ever unreachable the frontend silently falls back to its
local scoring engine, so a UI that looks healthy is not proof the backend is
up; check `/health` and the startup log, not the screen.

---

## 1. What has to exist

| Piece | Where | Why |
|---|---|---|
| Next.js frontend | Vercel (done) | Three surfaces |
| FastAPI backend | **DigitalOcean VPS** | Shield, Copilot, Ghost, auth |
| Persistent storage | **VPS Local Filesystem** | Survives redeploys |
| Paystack key | Vercel env | Real NUBAN resolution |
| SMTP | VPS env | Provisioning + OTP mail |

**Why not Vercel for the backend.** The API is a long-lived FastAPI service
with a database connection and background work. Vercel's functions are
stateless and short-lived. A dedicated VPS runs it as a real process.

---

## 2. Storage: read this before choosing Postgres

Locally the database is `api/fable.db`, because `FABLE_DB_PATH` is unset and
that is the default. **In the deployed container it is not.** The compose file
bind-mounts the host directory `api/data` to `/data` inside the container, and
`.env` sets `FABLE_DB_PATH=/data/fable.db`. So on the server the real file is:

```
/var/www/fable/api/data/fable.db     # host path, this is what you back up
/data/fable.db                       # the same file, seen from inside the container
```

The bind mount is what keeps the database alive across image rebuilds. Rebuild
the image as often as you like; the data sits on the host and is untouched.

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
rewriting the SQLite-only SQL.

### Recommended now: VPS + SQLite

Zero code changes, and the VPS filesystem **does** persist.
Limits worth knowing: single writer, and it will not scale past one instance.
For a demo, a pitch, and early pilot traffic that is genuinely fine.

### Later: the Postgres port

Do this when you need concurrent writers or more than one instance. Scope:
swap the driver, convert placeholders, replace the five SQLite-only
constructs above, and keep `_migrate()` working. Budget a focused session,
not a deploy-day change.

---

## 3. Deploy the backend (DigitalOcean / VPS)

**This is a Docker Compose deployment.** `api/Dockerfile` and
`api/docker-compose.yml` are both in the repository, so there is nothing to
author by hand. There is no virtualenv and no systemd unit on the server; if
you are reaching for `systemctl`, you are on the wrong path.

### First-time setup

1. **Clone the repository** to the server, for example `/var/www/fable`.
2. **Create the data directory and environment file:**
   ```bash
   cd /var/www/fable/api
   mkdir -p data
   cp .env.example .env
   # Edit .env. FABLE_DB_PATH=/data/fable.db is required, and must match
   # the bind mount in docker-compose.yml.
   ```
3. **Build and start:**
   ```bash
   docker compose up -d --build
   docker compose logs --tail=40 api
   ```

`docker compose` reads `docker-compose.yml` from the **current directory**, so
every command in this document assumes you are in `/var/www/fable/api`, not the
repository root. Running it from the root fails with
`no configuration file provided: not found`.

The compose project is named after that directory, which is why the running
container is `api-api-1` and the image is `api-api`.

---

## 4. Deploying an update

This is the step that catches people, so it gets its own section.

**The application code is copied into the image at build time** (`COPY . .` in
the Dockerfile). It is not bind-mounted. That means:

> A `git pull` changes the files on disk and has **no effect** on the running
> container. Neither does `docker compose restart`, which recreates the
> container from the **existing** image. You must rebuild.

```bash
cd /var/www/fable/api

# 1. Get the new code
git pull origin main

# 2. Back up the database first. Cheap, and the only thing that is not
#    reproducible if a migration goes wrong.
cp data/fable.db data/fable.db.bak-$(date +%Y%m%d-%H%M%S)

# 3. Rebuild the image and recreate the container
docker compose up -d --build

# 4. Confirm it came up and that every router registered
docker compose logs --tail=40 api | grep -i "routers loaded"
```

The log line to look for is `Fable API routers loaded: ...`. If `shield` is
missing from that list, the scoring engine failed to import and the API is
serving a 404 on `/v1/shield/analyze` while `/health` still returns 200. See
section 9.

**Verify the deploy actually took.** The cheapest proof is a request that the
new code rejects and the old code accepts:

```bash
curl -s http://127.0.0.1:8010/v1/shield/analyze -X POST \
  -H 'Content-Type: application/json' \
  -d '{"user_id":"meridian_ada","transaction":{"amount":-5000,"recipient_account":"0123456789"}}'
```

A `422` with `"Input should be greater than 0"` means the new code is live. A
risk score and a `PASS` means the container is still running the old image.

### Rolling back

Images are tagged `api-api:latest` on every build, so there is no previous tag
to fall back to. Roll back with git and rebuild:

```bash
cd /var/www/fable
git log --oneline -5
git checkout <previous-good-sha>
cd api && docker compose up -d --build
```

If a migration corrupted data, restore the backup **before** rebuilding:

```bash
cd /var/www/fable/api
docker compose down
cp data/fable.db.bak-<timestamp> data/fable.db
docker compose up -d --build
```

---

## 5. Exposing it to the Internet (Nginx)

The container binds to `127.0.0.1:8010`, so the API is not reachable from outside the host on its own. To expose it to Vercel securely, configure Nginx to reverse proxy to it with SSL. WebAuthn (Passkeys) strictly requires HTTPS.

```nginx
server {
    server_name api.yourdomain.com; # Or a free nip.io domain

    location / {
        proxy_pass http://127.0.0.1:8010;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```
Run `certbot --nginx -d api.yourdomain.com` to secure it.

---

## 6. Point the frontend at it

In Vercel → your project → **Settings → Environment Variables**:

```bash
NEXT_PUBLIC_FABLE_API_URL=https://api.yourdomain.com
PAYSTACK_SECRET_KEY=sk_test_...
```

`NEXT_PUBLIC_` is required — without the prefix the value never reaches the
browser, and the demo bank is what calls the API.

**Redeploy after setting them.** `NEXT_PUBLIC_*` values are inlined at build
time, so an existing deployment will keep using the old value.

---

## 7. Move the local database up

If you want to use a local database as the starting point, be precise about
what is in it: three institutions, their customers, ~90 days of
seeded history, branding, and API keys.

### Option A — reseed on the server (cleanest)

Nothing to migrate. Provision fresh and let the seeder run:

```bash
curl -X POST https://api.yourdomain.com/admin/provision \
  -H "Content-Type: application/json" \
  -d '{"institution_name":"Meridian MFB","admin_email":"risk@meridian.ng"}'
```

Each provision creates the tenant, its customers and 90 days of history. This
is what I'd do: the local DB's history is generated anyway, so copying it
carries no information that reseeding doesn't reproduce.

### Option B — carry the local data across

Only worth it if you've made transfers you want to keep. Staying on SQLite, the simplest move is to securely copy the file straight onto the VPS:

```bash
scp api/fable.db user@your_vps_ip:/var/www/fable/api/data/fable.db
# Then rebuild so the container picks it up: cd api && docker compose up -d --build
```

⚠️ **Passkeys will not survive**, whichever option you pick. A credential is
bound to the Relying Party ID it was registered against, so anything enrolled
on `localhost` is invalid on your live domain. Customers re-enrol on first
step-up. This is WebAuthn working correctly, not a bug.

---

## 8. Post-deploy checklist

```bash
API=https://api.yourdomain.com

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

## 9. Things that will bite you

**A failed router import is nearly silent.** `main.py` loads routers
defensively so one broken module cannot stop the process booting. The tradeoff
is that if `routers/shield` fails to import, for any reason, you get a single
`WARNING` line and an API that answers `/health` with 200 while
`/v1/shield/analyze` returns 404. The whole scoring engine is gone and nothing
obvious says so. Always grep the startup log for `routers loaded` after a
deploy and confirm `shield` is in the list.

**Paystack IP allowlist.** Your VPS egress IP is not your laptop's, and
Paystack enforces the allowlist per endpoint — `/bank` can succeed while
`/bank/resolve` is refused, which makes a broken integration look healthy.
Clear the Test IP box in the Paystack dashboard, or add your VPS egress IP.
`/api/paystack-status` diagnoses this in one call.

**Paystack test-mode daily limit.** A test key allows only **three live bank
resolutions per day**. Past that the API returns 429 and resolution falls back
to generated names — which looks like broken code but is a hard limit on
Paystack's side. `/api/paystack-status` reports it as `rate_limited`. Going to
live mode lifts it, at real cost per lookup.

**WebAuthn RP ID.** Must be the registrable domain with no scheme or port. A
mismatch fails at verification time, not registration, so it looks like a
signature problem rather than config.

**Seed drift.** Passing transfers are learned as legitimate and shift
baselines, so a demo gets duller the more you rehearse. Reset before pitching:

```bash
curl -X POST $API/v1/demo/seed-institution \
  -H "Content-Type: application/json" \
  -d '{"institution_id":"meridian","days":90}'
```

---

## 10. Rough costs

| Service | Tier | Cost |
|---|---|---|
| Vercel | Hobby | Free |
| DigitalOcean VPS | Basic Droplet | ~$4 - $6/mo |
| Paystack | Test mode | Free |
| OpenAI | Pay-as-you-go | Cents at demo volume |
