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

Those appear across `core/db.py`, `services/branding.py`, and the `admin`, `auth` and `demo`
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
   # the bind mount in docker-compose.yml. Also set, for production:
   #   FABLE_SESSION_SECRET   signs console and operator sessions; unset,
   #                          everyone is signed out whenever the API restarts
   #   FABLE_PIN_PEPPER       server-held key in every PIN hash (+ FABLE_PIN_PEPPER_ID=1)
   #   FABLE_SECRETS_KEY      master key for integration keys stored from the
   #                          operator console (+ FABLE_SECRETS_KEY_ID=k1)
   #   FABLE_CORS_ORIGINS     your Vercel origins instead of "*"
   #   FRONTEND_URL, WEBAUTHN_RP_ID / WEBAUTHN_ORIGINS, and SMTP_* for email
   # api/.env.example documents every setting and its default.
   chmod 600 .env
   ```
   Generate the three secrets with:
   ```bash
   python3 -c "import secrets;print('FABLE_SESSION_SECRET='+secrets.token_urlsafe(48))" >> .env
   python3 -c "import secrets;print('FABLE_PIN_PEPPER='+secrets.token_urlsafe(32))" >> .env
   python3 -c "import secrets,base64;print('FABLE_SECRETS_KEY='+base64.urlsafe_b64encode(secrets.token_bytes(32)).decode())" >> .env
   ```
   **Back up `FABLE_PIN_PEPPER` and `FABLE_SECRETS_KEY` offline**, in a password
   manager two trusted people can open. Losing the pepper means every customer
   sets a new PIN; losing the master key means re-entering every integration key.
   See [SECRETS.md](SECRETS.md).
3. **Build and start:**
   ```bash
   docker compose up -d --build
   docker compose logs --tail=40 api
   ```
4. **Create the first Fable operator** (a platform owner). They enrol an
   authenticator app at first sign-in at `/operator/login`:
   ```bash
   docker compose exec api python scripts/create_operator.py you@yourcompany.com "Your Name"
   ```
   Institutions are then created from the operator platform, empty and in
   sandbox mode, with the owner invited by email. There is no provisioning key.

`docker compose` reads `docker-compose.yml` from the **current directory**, so
every command in this document assumes you are in `/var/www/fable/api`, not the
repository root. Running it from the root fails with
`no configuration file provided: not found`.

The compose project is named after that directory, which is why the running
container is `api-api-1` and the image is `api-api`.

---

## 4. Deploying an update

### Automatic (recommended)

Every push to `main` deploys the API by itself once its tests pass. The
frontend already deploys itself through Vercel.

GitHub Actions (the **Deploy API** job in `.github/workflows/ci.yml`) connects
to the droplet with a key that can only run one command,
`api/scripts/deploy_server.sh`, installed as `/usr/local/bin/fable-deploy`. That
script:

1. takes the latest `main` (a reset, so a rewritten history never blocks it;
   `.env` and the database are ignored by git and kept);
2. backs up the database with SQLite's own backup, keeping the last 10;
3. rebuilds and recreates the container;
4. waits for `/health` to answer **with every required router loaded**;
5. if that fails, rebuilds the previous version and marks the run failed, so a
   broken push never stays live.

Deploys run one at a time; a second push waits for the first.

**One-time setup, on the droplet:**

```bash
cd /var/www/fable && git fetch origin && git reset --hard origin/main
install -m 755 api/scripts/deploy_server.sh /usr/local/bin/fable-deploy

# A key that can run the deploy and nothing else (no shell, no forwarding).
ssh-keygen -t ed25519 -N "" -C "github-deploy" -f /root/.ssh/github_deploy
echo "command=\"/usr/local/bin/fable-deploy\",restrict $(cat /root/.ssh/github_deploy.pub)" >> /root/.ssh/authorized_keys

# The two values GitHub needs:
cat /root/.ssh/github_deploy                                   # -> DEPLOY_SSH_KEY
echo "YOUR_DROPLET_IP $(cut -d' ' -f1,2 /etc/ssh/ssh_host_ed25519_key.pub)"   # -> DEPLOY_KNOWN_HOSTS
rm /root/.ssh/github_deploy                                    # GitHub keeps the only copy
```

**Then on GitHub:** the repository's **Settings → Secrets and variables →
Actions → New repository secret**, three times:

| Secret | Value |
|---|---|
| `DEPLOY_HOST` | the droplet's IP address |
| `DEPLOY_SSH_KEY` | the whole private key printed above, from `-----BEGIN` to `-----END` |
| `DEPLOY_KNOWN_HOSTS` | the one line printed after it |

`DEPLOY_USER` is optional (it defaults to `root`). Until the secrets exist the
deploy job skips with a notice instead of failing.

To deploy by hand at any time, on the droplet: `fable-deploy`. To see what a
deploy did: the **Actions** tab on GitHub, or the run's log.

**To revoke it:** delete the `github-deploy` line from
`/root/.ssh/authorized_keys`.

### By hand

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
#    reproducible if a migration goes wrong. Use SQLite's own backup, never a
#    plain `cp`: the database runs in WAL mode, so a copied file can silently
#    miss recent writes.
docker compose exec api python -c "import sqlite3; s=sqlite3.connect('/data/fable.db'); d=sqlite3.connect('/data/backup-$(date +%Y%m%d-%H%M%S).db'); s.backup(d); d.close(); print('backup ok')"

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
  -d '{"user_id":"cust_1","transaction":{"amount":-5000,"recipient_account":"0123456789"}}'
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

The container reports `(healthy)` in `docker compose ps` once `/health` answers.
`docker compose stop` now returns in a second or two.

If a migration corrupted data, restore the backup **before** rebuilding:

```bash
cd /var/www/fable/api
docker compose down
cp data/backup-<timestamp>.db data/fable.db
rm -f data/fable.db-wal data/fable.db-shm   # stale write-ahead files belong to the old database
docker compose up -d --build
```

### Maintenance scripts

One-off tools in `api/scripts/`. They change live data, so each one previews by
default and only acts when you add `--apply`. Stop the API first so nothing
writes mid-change, and take a backup (section 4). Run them from
`/var/www/fable/api`:

```bash
docker compose stop api

# Clear one institution's customer data (dry run first)
docker compose run --rm api python scripts/clear_institution_data.py <id>
docker compose run --rm api python scripts/clear_institution_data.py <id> --apply

# Remove every institution except the ones you name (irreversible; read the preview)
docker compose run --rm api python scripts/remove_institutions.py --keep ecobank
docker compose run --rm api python scripts/remove_institutions.py --keep ecobank --apply

# Change an institution's internal id
docker compose run --rm api python scripts/rename_institution.py old_id new_id --apply

docker compose up -d api
```

`scripts/pin_tool.py` clears a customer's PIN (see PIN-RECOVERY.md) and
`scripts/change_admin_email.py` changes a console login email. For integration
keys (see SECRETS.md): `import_env_secrets.py` moves keys from `.env` into
encrypted storage, `verify_secret_audit.py` checks the key audit trail is
intact, and `rewrap_secrets.py` rotates the master key. These three run with
the API up (`docker compose exec -T api python scripts/...`). Each script's
docstring has the details. After a code change that touches the schema, a
restart migrates the database in place.

To run the tests, install the dev requirements first (the production image does
not include pytest): `pip install -r requirements-dev.txt`, then `pytest`.

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

**Streaming.** Ask Fable streams its answers as server-sent events. The API
sends `X-Accel-Buffering: no`, which Nginx honours by default, so nothing is
needed. Only if answers arrive all at once, add `proxy_buffering off;` to the
location block above and run `sudo nginx -t && sudo systemctl reload nginx`.

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

## 7. Data on a new server

Fable has no demo data. A new server starts with an empty database: create the
first operator (section 3), then create institutions from the operator platform.
Each institution brings its own customers and history through **Settings >
Data** in its console, by CSV or the imports API.

To move an existing database to a new server instead, take a backup with
SQLite's backup API (never a plain copy, the database runs in WAL mode):

```bash
# On the old server
docker compose exec -T api python -c "import os,sqlite3; s=sqlite3.connect(os.environ.get('FABLE_DB_PATH') or '/app/fable.db'); d=sqlite3.connect('/data/move.db'); s.backup(d); d.close()"
# Copy data/move.db across, then on the new server
docker compose stop api && mv data/move.db data/fable.db && rm -f data/fable.db-wal data/fable.db-shm && docker compose up -d --build
```

Copy `.env` across too: without the same `FABLE_SESSION_SECRET`,
`FABLE_PIN_PEPPER` and `FABLE_SECRETS_KEY`, sessions end, PINs stop verifying
and stored keys cannot be read. Delete `move.db` afterwards: it holds every
institution's data.

⚠️ **Passkeys are bound to the domain.** A credential registered on one domain
(including `localhost`) is invalid on another. Customers and operators
re-enrol. This is WebAuthn working correctly.

---

## 8. Post-deploy checklist

```bash
API=https://api.yourdomain.com

# Backend alive
curl -s $API/health

# Paystack reachable from Vercel (not from your laptop)
curl -s https://fablehq.vercel.app/api/paystack-status

# Console data is closed to anyone without a session: expect 401
curl -s -o /dev/null -w "%{http_code}\n" "$API/v1/agents/overview"
```

In the browser:

- [ ] `/demo/<your-institution>` loads with the tenant's own branding
- [ ] Console login at `/dashboard/login` works
- [ ] A transfer appears in the console within ~4 seconds
- [ ] Settings, API & webhooks shows the masked API key, and rotating it shows the new key once
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

---

## 10. Rough costs

| Service | Tier | Cost |
|---|---|---|
| Vercel | Hobby | Free |
| DigitalOcean VPS | Basic Droplet | ~$4 - $6/mo |
| Paystack | Test mode | Free |
| OpenAI | Pay-as-you-go | Cents at demo volume |

## 11. Running on Linux locally (tests and the API, like production)

Production runs the API on Linux in `python:3.12-slim`. On a Windows machine
where Application Control blocks compiled Python packages (it blocked the
`cbor2` extension that passkeys need), run the API and its tests in that same
image instead of the Windows virtualenv. No new image is built or pulled if
`python:3.12-slim` is already present (`docker images`); the packages live in a
reusable volume.

Once, install the API's packages into the `fable-pydeps` volume (about 250 MB
download):

```bash
docker run --rm -v fable-pydeps:/deps -v "$PWD/api:/app:ro" -w /app python:3.12-slim \
  sh -c "python -m venv /deps/venv && /deps/venv/bin/pip install -q -r requirements-dev.txt"
```

Re-run it after `requirements*.txt` change.

Backend lint and tests (read-only on the source):

```bash
docker run --rm -v fable-pydeps:/deps -v "$PWD/api:/app:ro" -w /app python:3.12-slim sh scripts/linux_check.sh
```

Browser tests with the API on Linux (the browser and Next dev server stay on
the host; the e2e database lives in the `fable-e2e-data` volume):

```bash
FABLE_E2E_DOCKER=1 pnpm test:e2e                 # Git Bash, macOS, Linux
$env:FABLE_E2E_DOCKER = "1"; pnpm test:e2e       # PowerShell
```

The API for local development, on http://localhost:8000:

```bash
docker run --rm -p 8000:8000 -v fable-pydeps:/deps -v "$PWD/api:/app" -v fable-dev-data:/data -w /app \
  -e FABLE_DB_PATH=/data/fable.db -e FABLE_SESSION_SECRET=dev-only-secret python:3.12-slim \
  /deps/venv/bin/python -m uvicorn main:app --host 0.0.0.0 --port 8000 --reload
```

On Windows, Git Bash rewrites `/deps`-style paths: prefix these commands with
`MSYS_NO_PATHCONV=1`, or run them from PowerShell with `${PWD}`.

WSL2 works the same way: inside an Ubuntu shell, `python3.12 -m venv .venv &&
.venv/bin/pip install -r requirements-dev.txt` in `api/`, then `pytest`.
