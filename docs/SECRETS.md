# Secrets and integration keys

How Fable keeps its keys, who can change them, and what to do when something
goes wrong. Written for Fable's platform owners and whoever runs the server.

## Where each key lives

| Kind | Where | Changed by |
|---|---|---|
| Crypto roots: `FABLE_SESSION_SECRET`, `FABLE_SECRETS_KEY`, `FABLE_PIN_PEPPER` | `api/.env` on the server only | Someone with server access |
| Security routing: `SMTP_*`, `FRONTEND_URL`, `FABLE_CORS_ORIGINS`, `WEBAUTHN_*` | `api/.env` only | Someone with server access |
| Start-up settings: `FABLE_DB_PATH`, `ENVIRONMENT`, `SENTRY_DSN` | `api/.env` only | Someone with server access |
| Integration keys: OpenAI and Anthropic keys and models, LocationIQ, Geoapify, Google Maps | The operator console (**Environment**), or `api/.env` | Platform owners, with approval |
| Platform settings (readable): sandbox top-up limits, PIN length, attempts and lock time, weak-PIN refusal, default Ghost holds, branding limits, the API rate limit (`FABLE_RATE_LIMIT_MAX`, `FABLE_RATE_LIMIT_WINDOW`) and the explanation time limit (`FABLE_EXPLAINER_TIMEOUT`) | The operator console (**Environment**, type *Config*), or `api/.env` | Platform owners, with approval |
| Shield's signal weights and thresholds: `FABLE_W_*`, the channel risk weights `FABLE_CHANNEL_*`, `FABLE_BLOCK_THRESHOLD`, `FABLE_FLAG_THRESHOLD`, `FABLE_THRESHOLD_<CHANNEL>_*` | The operator console (**Engine**), versioned and backtested, or `api/.env` | Platform owners, with a backtest, approval, shadow and promotion ([ENGINE-GOVERNANCE.md](ENGINE-GOVERNANCE.md)) |
| Detection settings, which change whether a signal fires: `FABLE_VELOCITY_*`, `FABLE_TENURE_*`, `FABLE_RECIPIENT_MEMORY_DAYS` | The operator console (**Environment**, group *Scoring detection*), or `api/.env`. Shown read-only on the Engine page | Platform owners, with approval. Not backtested: a past decision cannot be replayed under them |
| Frontend: `PAYSTACK_SECRET_KEY`, `NEXT_PUBLIC_*` | Vercel project settings | Vercel team members (2FA on) |

The first three rows never move into the console. They either start the app or
protect sign-in and security emails, so a web page must not be able to change
them. If a key is set in `api/.env` **and** stored in the console, `.env` wins,
and the console shows it as managed in the server environment.

## How stored keys are protected

* **Envelope encryption.**
  * Each value is encrypted with AES-256-GCM under its own random data key.
  * That data key is encrypted with the master key, `FABLE_SECRETS_KEY`, which exists only in `api/.env`.
  * Each value is bound to its name, version and purpose, so a copied record does not decrypt anywhere else.
* **Write-only.**
  * After saving, the console shows the last four characters and a short fingerprint.
  * No page, API or log ever shows a key again.
* **Step-up on every change.**
  * Each change needs a passkey (preferred) or a fresh authenticator code. A code cannot be reused.
  * Five failures lock key actions, and only key actions, for that operator for 15 minutes. Every owner is emailed.
* **Maker-checker.**
  * A change waits for a different platform owner to approve it, within 24 hours.
  * With only one owner, it waits out a 12-hour cooling-off period instead. Every owner is emailed, and anyone can cancel.
* **Tested before use.**
  * A new key is checked with the provider before it is accepted, and again when it is approved.
  * A restored key is checked again first.
* **Compromise is final.**
  * A key retired as *compromised* is wiped at once and can never be restored.
  * A key retired in a *routine* rotation is kept, encrypted, for 7 days, then wiped.
* **Audit.**
  * Every action goes to a hash-chained trail, which `scripts/verify_secret_audit.py` checks.
  * It also goes to the main audit log, to the server's log stream, and to Sentry when configured.
  * No value is ever written to any of them. A log filter also scrubs anything shaped like a provider key.

## Everyday tasks

**Rotate a key**
1. Open **Environment** in the operator console, then **Rotate** from the variable's menu (⋯).
2. Paste the new key, pick *Routine* or *Compromised*, give a reason, and confirm with your passkey or code.
3. Another owner approves it under *Waiting for a decision*. It takes effect within 30 seconds, with no restart.

**Restore the previous key.** Open **History** from the key's menu and choose **Restore** on a routine version less than 7 days old. It is tested again, then needs approval like any change.

**Move keys and settings from `.env` into the console.** Do this once. The values go straight from `.env` into encrypted storage and are never printed:

```bash
cd /var/www/fable/api
docker compose exec -T api python scripts/import_env_secrets.py          # what would move
docker compose exec -T api python scripts/import_env_secrets.py --apply  # move them
nano .env    # delete those lines (they would otherwise keep winning)
docker compose up -d --force-recreate
```

**Check the audit trail**

```bash
docker compose exec -T api python scripts/verify_secret_audit.py
```

## The master key and the pepper

Both live only in `api/.env` (mode 600). Keep a second copy **offline**, in a
password manager vault that two trusted people can open (for example you and a
co-founder or technical lead). If you work alone, keep a second offline copy
somewhere safe.

| If it is lost | What happens |
|---|---|
| `FABLE_SECRETS_KEY` | Stored integration keys cannot be read. Re-enter them, or put them back in `.env`. |
| `FABLE_PIN_PEPPER` | No customer PIN verifies. Every customer sets a new PIN. Attempt limits and lockouts still apply. |

**Rotate the master key** without re-entering anything:

```bash
python3 -c "import secrets,base64;print(base64.urlsafe_b64encode(secrets.token_bytes(32)).decode())"   # new key
docker compose exec -T -e OLD_KEY='<current>' -e NEW_KEY='<new>' -e NEW_KID=k2 api python scripts/rewrap_secrets.py
# then set FABLE_SECRETS_KEY=<new> and FABLE_SECRETS_KEY_ID=k2 in .env and restart
```

**Rotate the pepper.** Set the old value as `FABLE_PIN_PEPPER_PREVIOUS="1:<old>"`, then the new value as `FABLE_PIN_PEPPER` with `FABLE_PIN_PEPPER_ID=2`, and restart. Each PIN moves to the new pepper the next time it is entered correctly. Keep the previous value until you expect every active customer has signed in.

## Break-glass

* **Stop all key changes now.** Set `FABLE_SECRETS_WRITE=off` in `.env` and restart. The console becomes read-only. The keys in use keep working.
* **A key is leaking.** Rotate it as *Compromised*. If no second owner is available, set the replacement in `.env`, where it wins immediately on restart, and rotate in the console later.
* **Suspect the trail was altered.** Run the verify script, then compare with the log stream: `docker compose logs api | grep secret_audit`.

## Standards this follows

The mapping is to frameworks, not quoted clauses. Clause numbers marked
*to verify* still need checking against the official texts.

* **NDPA 2023, security of processing** (s.39, to verify), **and GAID 2025.** Encryption, minimisation, and the cross-border notes in the privacy policy.
* **CBN Risk-Based Cybersecurity Framework 2024** (to verify). Key management, MFA for privileged access, segregation of duties, audit.
* **PCI DSS v4.0.** Requirements 3.6–3.7 (key management), 8.4 (MFA) and 10 (logging).
* **ISO/IEC 27001:2022.** Controls A.8.24 (cryptography), A.5.3 and A.8.2 (duties, privileged access), A.8.15 (logging) and A.8.32 (change management).
* **NIST SP 800-57 and the OWASP Secrets Management Cheat Sheet.**
