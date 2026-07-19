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
| FastAPI backend | **DigitalOcean VPS** | Shield, Copilot, Ghost, auth |
| Persistent storage | **VPS Local Filesystem** | Survives redeploys |
| Paystack key | Vercel env | Real NUBAN resolution |
| SMTP | VPS env | Provisioning + OTP mail |

**Why not Vercel for the backend.** The API is a long-lived FastAPI service
with a database connection and background work. Vercel's functions are
stateless and short-lived. A dedicated VPS runs it as a real process.

---

## 2. Storage: read this before choosing Postgres

`api/fable.db` works locally because the file persists. On a bare VPS (like DigitalOcean), the filesystem is inherently persistent, meaning SQLite works perfectly out of the box without special volume configuration.

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

### Option A: Docker Compose (Recommended)

Docker keeps the Python dependencies cleanly isolated from your system software.

1. **Clone the repository** to your server (e.g., `/var/www/fable`).
2. **Create a `docker-compose.yml`** in the `api/` directory:

```yaml
services:
  api:
    build: .
    restart: always
    ports:
      - "127.0.0.1:8010:8010"
    volumes:
      - ./data:/data
    env_file:
      - .env
```

3. **Configure the environment variables**:
   ```bash
   mkdir -p api/data
   cp api/.env.example api/.env
   # Edit .env and set FABLE_DB_PATH=/data/fable.db
   ```
4. **Start the container**:
   ```bash
   cd api
   docker compose up -d
   ```

### Option B: Systemd + Nginx (Raw Metal)

If you don't want Docker, you can run it as a standard Linux service directly on the host.

1. Setup the virtual environment:
   ```bash
   cd api
   python3 -m venv .venv
   source .venv/bin/activate
   pip install -r requirements.txt
   ```
2. Create a systemd service file `/etc/systemd/system/fable.service`:
   ```ini
   [Unit]
   Description=Fable FastAPI Backend
   After=network.target

   [Service]
   User=root
   WorkingDirectory=/var/www/fable/api
   Environment="PATH=/var/www/fable/api/.venv/bin"
   EnvironmentFile=/var/www/fable/api/.env
   ExecStart=/var/www/fable/api/.venv/bin/uvicorn main:app --host 127.0.0.1 --port 8010

   [Install]
   WantedBy=multi-user.target
   ```
3. Start it: `systemctl enable --now fable`.

---

## 4. Exposing it to the Internet (Nginx)

Whichever option you choose, your API is now running locally on port `8010`. To expose it to Vercel securely, configure Nginx to reverse proxy to it with SSL. WebAuthn (Passkeys) strictly requires HTTPS.

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

## 5. Point the frontend at it

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

## 6. Move the local database up

You asked about using the current local DB as the starting point. Worth being
precise about what's in it: three institutions, their customers, ~90 days of
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
```

⚠️ **Passkeys will not survive**, whichever option you pick. A credential is
bound to the Relying Party ID it was registered against, so anything enrolled
on `localhost` is invalid on your live domain. Customers re-enrol on first
step-up. This is WebAuthn working correctly, not a bug.

---

## 7. Post-deploy checklist

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

## 8. Things that will bite you

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

## 9. Rough costs

| Service | Tier | Cost |
|---|---|---|
| Vercel | Hobby | Free |
| DigitalOcean VPS | Basic Droplet | ~$4 - $6/mo |
| Paystack | Test mode | Free |
| OpenAI | Pay-as-you-go | Cents at demo volume |
