"""SQLite-backed persistence layer.

Mirrors the Supabase/Postgres schema from the implementation doc
(fable_users, transactions, ghost_containers, audit_log) so this can be
swapped for a real Supabase client later without changing agent logic.
"""
import json
import logging
import sqlite3
import threading
from contextlib import contextmanager

from core.config import DB_PATH

logger = logging.getLogger("fable.db")

_local = threading.local()

# Schema creation and migration are process-wide work, not per-connection work.
# They used to run inside get_conn(), which is guarded by threading.local() —
# so every new worker thread re-ran 20 CREATE TABLE statements, 6 PRAGMA
# table_info reads and 3 backfill UPDATEs. Under uvicorn's threadpool that is
# up to 40 executions spread across live traffic, not once at boot. It also
# meant the ghost_containers backfill kept firing during normal operation.
_init_lock = threading.Lock()
_initialized = False

SCHEMA = """
-- No longer written or read by the app (customers replaced it); kept, empty
-- on new installs, because migrations only ever add. Read once by the
-- customers backfill for databases from before the customers table.
CREATE TABLE IF NOT EXISTS fable_users (
    user_id TEXT PRIMARY KEY,
    -- No default: every customer is created for a named institution. A default
    -- tenant ('demo_bank', later 'meridian') used to fill this in, and rows
    -- written without one landed on a bank that might not exist.
    institution_id TEXT,
    enrolled_at TEXT DEFAULT (datetime('now')),
    copilot_enabled INTEGER DEFAULT 1,
    shield_enabled INTEGER DEFAULT 1,
    ghost_enabled INTEGER DEFAULT 1
);

CREATE TABLE IF NOT EXISTS transactions (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    amount REAL NOT NULL,
    currency TEXT DEFAULT 'NGN',
    recipient_id TEXT,
    recipient_account TEXT,
    recipient_bank TEXT,
    narration TEXT,
    channel TEXT,
    device_fingerprint TEXT,
    hour_of_day INTEGER,
    risk_score REAL,
    risk_level TEXT,
    action_taken TEXT,
    shield_signals TEXT,
    confirmed_legitimate INTEGER DEFAULT 1,
    is_seed INTEGER DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS ghost_containers (
    ghost_id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    amount REAL NOT NULL,
    recipient_id TEXT,
    recipient_account TEXT,
    recipient_bank TEXT,
    status TEXT DEFAULT 'HELD',
    cooling_window_minutes INTEGER,
    risk_score REAL,
    explanation TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    expires_at TEXT,
    resolved_at TEXT
);

CREATE TABLE IF NOT EXISTS audit_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id TEXT,
    event_type TEXT,
    payload TEXT,
    created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS api_keys (
    key TEXT PRIMARY KEY,
    institution_name TEXT NOT NULL,
    admin_email TEXT NOT NULL,
    created_at TEXT DEFAULT (datetime('now')),
    is_active INTEGER DEFAULT 1
);

CREATE TABLE IF NOT EXISTS admins (
    email TEXT PRIMARY KEY,
    institution_id TEXT NOT NULL,
    hashed_password TEXT NOT NULL,
    created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS password_resets (
    token TEXT PRIMARY KEY,
    email TEXT NOT NULL,
    expires_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS device_profiles (
    fingerprint_id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    platform TEXT,
    os TEXT,
    browser TEXT,
    screen TEXT,
    gpu TEXT,
    language TEXT,
    timezone TEXT,
    touch_support INTEGER,
    first_seen TEXT DEFAULT (datetime('now')),
    last_seen TEXT DEFAULT (datetime('now')),
    times_seen INTEGER DEFAULT 1,
    trust_score REAL DEFAULT 0.5
);

-- The devices each customer has used, one row per customer and device.
-- device_profiles keyed a row by the fingerprint alone, so the first customer
-- to use a device owned its row everywhere: another customer's transfers from
-- it, even at another bank, raised that row's trust and never counted as their
-- own. Scoped by customer (and so by bank) here.
CREATE TABLE IF NOT EXISTS customer_devices (
    user_id TEXT NOT NULL,
    institution_id TEXT,
    fingerprint_id TEXT NOT NULL,
    platform TEXT,
    os TEXT,
    browser TEXT,
    screen TEXT,
    gpu TEXT,
    language TEXT,
    timezone TEXT,
    touch_support INTEGER,
    first_seen TEXT DEFAULT (datetime('now')),
    last_seen TEXT DEFAULT (datetime('now')),
    times_seen INTEGER DEFAULT 1,
    trust_score REAL DEFAULT 0.5,
    trusted INTEGER DEFAULT 0,
    PRIMARY KEY (user_id, fingerprint_id)
);

-- Explanations keyed by the shape of the decision that produced them, so an
-- identical signal set never pays for the same sentence twice. Signal sets
-- repeat heavily in practice: "new recipient + amount anomaly + USSD" is one
-- of a few dozen combinations that cover most blocked transfers.
CREATE TABLE IF NOT EXISTS explanation_cache (
    signature TEXT PRIMARY KEY,
    action TEXT NOT NULL,
    explanation TEXT NOT NULL,
    hits INTEGER DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS user_locations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id TEXT NOT NULL,
    latitude REAL,
    longitude REAL,
    city TEXT,
    region TEXT,
    country TEXT,
    source TEXT,
    seen_at TEXT DEFAULT (datetime('now'))
);

-- Former ids of renamed institutions. Renaming an id (see
-- scripts/rename_institution.py) leaves the old one here, so links, settings and
-- open browser tabs that still use it keep resolving to the same institution.
CREATE TABLE IF NOT EXISTS institution_aliases (
    alias TEXT PRIMARY KEY,
    institution_id TEXT NOT NULL,
    created_at TEXT DEFAULT (datetime('now'))
);

-- Failed console sign-ins, for throttling password guessing. Pruned as it goes.
CREATE TABLE IF NOT EXISTS login_failures (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT NOT NULL,
    ip TEXT,
    at INTEGER NOT NULL
);

-- Former ids of renamed customers (see scripts/rename_customers.py).
-- No longer written by the app; kept because migrations only ever add.
CREATE TABLE IF NOT EXISTS user_aliases (
    alias TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS institutions (
    institution_id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    type TEXT DEFAULT 'Financial Institution',
    contact_email TEXT,
    created_at TEXT DEFAULT (datetime('now'))
);

-- Per-institution branding the demo bank renders instead of Fable defaults.
-- Kept as columns rather than a key/value bag because every field is known,
-- typed and read together on each page load.
CREATE TABLE IF NOT EXISTS institution_branding (
    institution_id TEXT PRIMARY KEY,
    display_name TEXT,
    logo_url TEXT,
    primary_color TEXT,
    accent_color TEXT,
    slug TEXT,                        -- vanity URL, distinct from institution_id
    support_email TEXT,
    tagline TEXT,
    updated_at TEXT,
    -- Renaming the public URL breaks every link already handed out, so a
    -- change locks the slug for a configurable cooling period.
    slug_locked_until TEXT
);

-- Server-authoritative balances. The demo bank previously derived a balance
-- on the client from an opening figure that nothing debited and nothing
-- checked, so a transfer could exceed it freely.
CREATE TABLE IF NOT EXISTS accounts (
    user_id TEXT PRIMARY KEY,
    institution_id TEXT,
    balance REAL NOT NULL DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
);

-- Every movement, explainable. A fraud product that cannot say why a balance
-- is what it is has no business holding one.
CREATE TABLE IF NOT EXISTS ledger_entries (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id TEXT NOT NULL,
    institution_id TEXT,
    kind TEXT NOT NULL,            -- topup | debit | reversal | release
    amount REAL NOT NULL,
    balance_after REAL NOT NULL,
    transaction_id TEXT,
    reference TEXT UNIQUE,         -- idempotency: a retry cannot double-move
    created_at TEXT DEFAULT (datetime('now'))
);

-- Customer-held security factors. The PIN is hashed and rate-limited; it is a
-- real factor, not a prop.
CREATE TABLE IF NOT EXISTS user_security (
    user_id TEXT PRIMARY KEY,
    institution_id TEXT,
    pin_hash TEXT,
    pin_set_at TEXT,
    failed_attempts INTEGER DEFAULT 0,
    locked_until TEXT,
    two_factor_enabled INTEGER DEFAULT 0,
    updated_at TEXT DEFAULT (datetime('now'))
);

-- Registered WebAuthn passkeys. The private key never leaves the
-- authenticator; we hold only the public key and the signature counter.
CREATE TABLE IF NOT EXISTS user_credentials (
    credential_id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    institution_id TEXT,
    public_key TEXT NOT NULL,
    sign_count INTEGER DEFAULT 0,
    transports TEXT,
    device_label TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    last_used_at TEXT
);

-- Short-lived challenges: WebAuthn nonces and emailed OTP codes. Rows are
-- single-use and expire; a consumed or stale row can never be replayed.
CREATE TABLE IF NOT EXISTS stepup_challenges (
    challenge_id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    kind TEXT NOT NULL,               -- 'webauthn_register' | 'webauthn_auth' | 'otp'
    payload TEXT NOT NULL,            -- challenge bytes (b64) or hashed OTP
    purpose TEXT,                     -- 'transfer' | 'ghost_release'
    reference TEXT,                   -- ghost_id / transaction id the step-up is bound to
    attempts INTEGER DEFAULT 0,
    consumed INTEGER DEFAULT 0,
    expires_at TEXT NOT NULL,
    created_at TEXT DEFAULT (datetime('now'))
);

-- Proof that a factor was completed. Presented when releasing money; bound to
-- one user, one purpose and one reference so a token minted for a small
-- transfer cannot be replayed against a large one.
CREATE TABLE IF NOT EXISTS stepup_tokens (
    token TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    level TEXT NOT NULL,
    purpose TEXT,
    reference TEXT,
    consumed INTEGER DEFAULT 0,
    expires_at TEXT NOT NULL,
    created_at TEXT DEFAULT (datetime('now'))
);

-- Failed factor attempts, so Shield can treat "three failed biometrics before
-- a large transfer" as the evidence it plainly is.
-- What the customer was told, and whether it actually reached them.
--
-- Containment used to notify nobody: a transfer entered a cooling window and
-- the only notice appeared on the screen the transfer came from, which is the
-- screen an attacker is holding in the case containment exists to survive.
-- `delivered` is recorded honestly, so an alert that only ever appeared in-app
-- is distinguishable from one that reached the customer out-of-band.
CREATE TABLE IF NOT EXISTS notifications (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id TEXT NOT NULL,
    institution_id TEXT,
    kind TEXT NOT NULL,            -- containment | blocked | flagged | credit
    title TEXT NOT NULL,
    body TEXT NOT NULL,
    reference TEXT,                -- ghost_id or transaction id
    channel TEXT DEFAULT 'in_app', -- in_app | email | sms
    delivered INTEGER DEFAULT 0,
    read_at TEXT,
    created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS stepup_failures (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id TEXT NOT NULL,
    kind TEXT,
    reason TEXT,
    created_at TEXT DEFAULT (datetime('now'))
);

-- Analyst notes on a reviewed transaction. The review state itself lives on the
-- transaction row; notes are a thread, so they get their own table.
CREATE TABLE IF NOT EXISTS case_notes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    transaction_id TEXT NOT NULL,
    institution_id TEXT NOT NULL,
    author TEXT NOT NULL,
    body TEXT NOT NULL,
    created_at TEXT DEFAULT (datetime('now'))
);

-- An institution's own risk policy. NULL means "use Fable's defaults", so a bank
-- that never opens the settings page scores exactly as before.
CREATE TABLE IF NOT EXISTS institution_settings (
    institution_id TEXT PRIMARY KEY,
    flag_threshold REAL,
    block_threshold REAL,
    hold_high_minutes INTEGER,
    hold_medium_minutes INTEGER,
    hold_low_minutes INTEGER,
    updated_by TEXT,
    updated_at TEXT DEFAULT (datetime('now'))
);

-- Where an institution wants decisions pushed. The secret signs every delivery
-- so the receiver can prove the call came from Fable.
CREATE TABLE IF NOT EXISTS webhooks (
    id TEXT PRIMARY KEY,
    institution_id TEXT NOT NULL,
    url TEXT NOT NULL,
    secret TEXT NOT NULL,
    events TEXT NOT NULL,
    active INTEGER DEFAULT 1,
    created_by TEXT,
    created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS webhook_deliveries (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    webhook_id TEXT NOT NULL,
    institution_id TEXT NOT NULL,
    event TEXT NOT NULL,
    status_code INTEGER,
    ok INTEGER DEFAULT 0,
    error TEXT,
    attempt INTEGER DEFAULT 1,
    created_at TEXT DEFAULT (datetime('now'))
);

-- Webhook events waiting to be delivered. Written in the same moment as the
-- action that caused them and delivered from here, so a restart no longer
-- loses a retry that was sleeping in a thread. One row per endpoint per event;
-- the event id is fixed when the row is written, so a receiver can de-duplicate
-- retries.
CREATE TABLE IF NOT EXISTS webhook_outbox (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    webhook_id TEXT NOT NULL,
    institution_id TEXT NOT NULL,
    event TEXT NOT NULL,
    event_id TEXT NOT NULL,
    payload TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',   -- pending | sending | delivered | failed
    attempts INTEGER NOT NULL DEFAULT 0,
    next_attempt_at REAL NOT NULL DEFAULT 0,
    claimed_at REAL,
    last_error TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    delivered_at TEXT
);

-- Transfers Fable decided on and handed to the Xtradot Bank sandbox (Forge).
-- `state` follows the money: decided | awaiting_stepup | held | sending |
-- unknown | pending | successful | failed | reversed. `reference` is what the
-- bank knows the transfer by, and is unique, so the same transfer can never be
-- created twice.
CREATE TABLE IF NOT EXISTS forge_transfers (
    id TEXT PRIMARY KEY,                       -- the Fable decision (transactions.id)
    institution_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    reference TEXT NOT NULL UNIQUE,
    source_account TEXT NOT NULL,
    destination_account TEXT NOT NULL,
    destination_bank_code TEXT,
    intra INTEGER NOT NULL DEFAULT 0,
    recipient_name TEXT,
    amount REAL NOT NULL,
    narration TEXT,
    name_enquiry_ref TEXT,
    name_enquiry_at REAL,
    action TEXT,                               -- the decision: PASS | FLAG | BLOCK
    state TEXT NOT NULL,
    fee REAL,
    vat REAL,
    stamp_duty REAL,
    total_debit REAL,
    last_error TEXT,
    trail TEXT,                                -- JSON: every state it passed through, with the reason
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
);

-- Webhook events already handled, so a retried delivery changes nothing.
CREATE TABLE IF NOT EXISTS forge_events (
    event_id TEXT PRIMARY KEY,
    event TEXT NOT NULL,
    received_at TEXT DEFAULT (datetime('now'))
);

-- What a sandbox bank's test customers would have received: one-time codes
-- and notices. Shown in the demo app so testing never depends on a real
-- inbox. Never written for a live bank (services/delivery.py).
CREATE TABLE IF NOT EXISTS sandbox_inbox (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    institution_id TEXT,
    user_id TEXT NOT NULL,
    kind TEXT NOT NULL,              -- 'code' | 'notice'
    channel TEXT,
    destination TEXT,                -- masked
    subject TEXT,
    body TEXT,
    code TEXT,
    purpose TEXT,
    reference TEXT,
    created_at TEXT DEFAULT (datetime('now'))
);

-- When each background job last ran, and the lease that keeps two workers
-- from running the same job at once (services/scheduler.py).
-- What each decision was scored on, for training and backtesting a richer
-- per-customer model later (agents/shield/features.py). No names, account
-- numbers, narration, exact GPS or IP addresses. Follows the decision's
-- retention and the customer's erasure.
CREATE TABLE IF NOT EXISTS decision_features (
    transaction_id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    institution_id TEXT,
    feature_version INTEGER NOT NULL,
    features TEXT NOT NULL,
    created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS job_runs (
    name TEXT PRIMARY KEY,
    holder TEXT,
    lease_until REAL NOT NULL DEFAULT 0,
    last_started REAL NOT NULL DEFAULT 0,
    last_finished REAL,
    last_ok INTEGER,
    last_detail TEXT,
    runs INTEGER DEFAULT 0,
    failures INTEGER DEFAULT 0
);

-- A bank's customers. The bank knows a customer by its own reference
-- (external_ref); Fable keys everything else by id, which is unique across
-- banks. Two banks can both have a customer "10293" without sharing a
-- baseline, a balance or a history.
CREATE TABLE IF NOT EXISTS customers (
    id TEXT PRIMARY KEY,
    institution_id TEXT NOT NULL,
    external_ref TEXT NOT NULL,
    display_name TEXT,
    phone TEXT,
    email TEXT,
    segment TEXT,
    -- test: a sandbox customer the bank created to try Fable. real: a customer
    -- of the bank, from an import or its live traffic.
    kind TEXT NOT NULL DEFAULT 'real',
    status TEXT NOT NULL DEFAULT 'active',
    source TEXT NOT NULL DEFAULT 'api',
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now')),
    UNIQUE (institution_id, external_ref)
);

-- A bank's past transfers, imported when it joins so its customers do not
-- start cold. Kept apart from transactions, which are Shield's decisions:
-- history was never scored, raised no alerts and must not count as decisions
-- in the console. Scoring reads both through the customer_history view.
CREATE TABLE IF NOT EXISTS transaction_history (
    id TEXT PRIMARY KEY,
    institution_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    reference TEXT NOT NULL,
    amount REAL NOT NULL,
    recipient_account TEXT,
    recipient_bank TEXT,
    recipient_name TEXT,
    channel TEXT,
    device_fingerprint TEXT,
    city TEXT,
    country TEXT,
    hour_of_day INTEGER,
    -- completed, reversed, or fraud (confirmed by the bank). Only completed
    -- transfers teach the baseline; fraud is kept as a label for training.
    outcome TEXT NOT NULL DEFAULT 'completed',
    confirmed_legitimate INTEGER NOT NULL DEFAULT 1,
    import_job_id TEXT,
    created_at TEXT NOT NULL,
    imported_at TEXT DEFAULT (datetime('now')),
    UNIQUE (institution_id, reference)
);

-- One upload or batch of customers or history, from validation to applied.
CREATE TABLE IF NOT EXISTS import_jobs (
    id TEXT PRIMARY KEY,
    institution_id TEXT NOT NULL,
    kind TEXT NOT NULL,
    filename TEXT,
    status TEXT NOT NULL,
    total INTEGER DEFAULT 0,
    valid INTEGER DEFAULT 0,
    invalid INTEGER DEFAULT 0,
    inserted INTEGER DEFAULT 0,
    skipped INTEGER DEFAULT 0,
    errors TEXT,
    created_by TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    finished_at TEXT
);

-- Fable's own staff, who provision and look after institutions. Separate from
-- any bank's console members. The authenticator secret is stored encrypted.
CREATE TABLE IF NOT EXISTS operators (
    email TEXT PRIMARY KEY,
    name TEXT,
    role TEXT NOT NULL DEFAULT 'support',
    hashed_password TEXT NOT NULL,
    totp_secret TEXT,
    totp_enabled INTEGER NOT NULL DEFAULT 0,
    totp_last_step INTEGER,
    active INTEGER NOT NULL DEFAULT 1,
    session_version INTEGER NOT NULL DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now')),
    last_login_at TEXT
);

-- One-time links for a new operator to set their password. Stored hashed.
CREATE TABLE IF NOT EXISTS operator_invites (
    token TEXT PRIMARY KEY,
    email TEXT NOT NULL,
    expires_at INTEGER NOT NULL
);

-- Rows that passed validation, waiting for the bank to confirm the import.
-- Deleted once the job is applied or discarded.
CREATE TABLE IF NOT EXISTS import_rows (
    job_id TEXT NOT NULL,
    line INTEGER NOT NULL,
    data TEXT NOT NULL
);

-- Platform-wide settings an operator can change, such as Ask Fable's limits.
-- One JSON value per key; a missing key means the built-in default.
CREATE TABLE IF NOT EXISTS platform_settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_by TEXT,
    updated_at TEXT DEFAULT (datetime('now'))
);

-- Integration keys managed from the operator console (see core/secrets.py).
-- One row per name and version. Values are envelope-encrypted: AES-256-GCM
-- under a per-value data key, which is itself wrapped by the master key held
-- only in the server environment. Nothing here is readable without it.
CREATE TABLE IF NOT EXISTS platform_secrets (
    name TEXT NOT NULL,
    version INTEGER NOT NULL,
    status TEXT NOT NULL,                 -- active | retired | revoked
    ciphertext BLOB,                      -- NULL once revoked or wiped
    nonce BLOB,
    wrapped_key BLOB,
    kid TEXT,
    last4 TEXT,
    fingerprint TEXT,
    rotation_reason TEXT,                 -- initial | routine | compromised | rollback
    set_by TEXT,
    approved_by TEXT,
    change_id TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    retired_at TEXT,
    PRIMARY KEY (name, version)
);

-- A proposed change to an integration key, waiting for a second owner (or a
-- cooling-off period when there is only one). The proposed value is encrypted
-- the same way, bound to this change, and wiped once decided.
CREATE TABLE IF NOT EXISTS secret_changes (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    action TEXT NOT NULL,                 -- set | rollback | remove
    status TEXT NOT NULL,                 -- pending | cooling | applied | rejected | cancelled | expired
    rotation_reason TEXT,
    reason TEXT,
    target_version INTEGER,
    ciphertext BLOB,
    nonce BLOB,
    wrapped_key BLOB,
    kid TEXT,
    last4 TEXT,
    fingerprint TEXT,
    proposed_by TEXT NOT NULL,
    single_approver INTEGER NOT NULL DEFAULT 0,
    decided_by TEXT,
    decided_at TEXT,
    apply_after TEXT,
    expires_at TEXT,
    created_at TEXT DEFAULT (datetime('now'))
);

-- Every secret action, hash-chained: each row carries the hash of the one
-- before it, so a deleted or edited row breaks the chain
-- (scripts/verify_secret_audit.py). Also copied to the log stream.
CREATE TABLE IF NOT EXISTS secret_audit (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    at TEXT NOT NULL,
    event TEXT NOT NULL,
    name TEXT,
    version INTEGER,
    change_id TEXT,
    actor TEXT,
    detail TEXT,
    prev_hash TEXT NOT NULL,
    hash TEXT NOT NULL
);

-- Operators' passkeys, the preferred factor for step-up on secret actions.
CREATE TABLE IF NOT EXISTS operator_passkeys (
    credential_id TEXT PRIMARY KEY,
    email TEXT NOT NULL,
    public_key TEXT NOT NULL,
    sign_count INTEGER NOT NULL DEFAULT 0,
    label TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    last_used_at TEXT
);

-- Failed step-ups for secret actions. Locks secret actions only, never the
-- operator's account.
CREATE TABLE IF NOT EXISTS operator_stepup (
    email TEXT PRIMARY KEY,
    failures INTEGER NOT NULL DEFAULT 0,
    locked_until TEXT
);

-- Shield's tunable weights and thresholds, one row per version (see
-- core/engine_config.py). params is canonical JSON; approved_hash freezes it
-- once proposed, and shadow/promote refuse a row whose params no longer match.
CREATE TABLE IF NOT EXISTS engine_versions (
    version INTEGER PRIMARY KEY,
    status TEXT NOT NULL,                 -- draft | proposed | cooling | approved | shadow | active | retired | rejected | expired
    params TEXT NOT NULL,
    params_hash TEXT NOT NULL,
    approved_hash TEXT,
    base_version INTEGER,
    rollback_of INTEGER,
    backtest TEXT,
    backtest_at TEXT,
    backtest_hash TEXT,
    note TEXT,
    drift_note TEXT,
    impact_ack INTEGER NOT NULL DEFAULT 0,
    created_by TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    proposed_by TEXT,
    proposed_at TEXT,
    single_approver INTEGER NOT NULL DEFAULT 0,
    apply_after TEXT,
    expires_at TEXT,
    approved_by TEXT,
    approved_at TEXT,
    decided_by TEXT,
    decided_at TEXT,
    shadow_started_at TEXT,
    shadow_until TEXT,
    shadow_by TEXT,
    activated_at TEXT,
    activated_by TEXT,
    retired_at TEXT
);

-- Every period a version was live: when, who and how (seed, promote,
-- rollback). The drift cap compares against the version live 30 days ago.
CREATE TABLE IF NOT EXISTS engine_activations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    version INTEGER NOT NULL,
    started_at TEXT NOT NULL,
    ended_at TEXT,
    by TEXT,
    kind TEXT
);

-- Ask Fable for one institution, where an operator has overridden the
-- platform setting. NULL means "use the platform setting".
CREATE TABLE IF NOT EXISTS institution_assistant (
    institution_id TEXT PRIMARY KEY,
    enabled INTEGER,
    daily_answers INTEGER,
    updated_by TEXT,
    updated_at TEXT DEFAULT (datetime('now'))
);

-- Ask Fable usage per person per day (Lagos time): questions asked, how many
-- were answered by a model, how many from the cache, and the tokens spent.
CREATE TABLE IF NOT EXISTS assistant_usage (
    institution_id TEXT NOT NULL,
    email TEXT NOT NULL,
    day TEXT NOT NULL,
    questions INTEGER NOT NULL DEFAULT 0,
    model_answers INTEGER NOT NULL DEFAULT 0,
    cached_answers INTEGER NOT NULL DEFAULT 0,
    input_tokens INTEGER NOT NULL DEFAULT 0,
    output_tokens INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (institution_id, email, day)
);
"""

# The tenant every pre-multi-tenant row belongs to. Existing databases were
# single-tenant, so their history is backfilled to this institution.

# Columns added after the original schema shipped. Existing fable.db files are
# upgraded in place at boot via PRAGMA table_info diffing.
MIGRATIONS = {
    # A free-text note on a secret or setting: where it is rotated, who owns it.
    "platform_secrets": {"note": "TEXT"},
    "secret_changes": {"note": "TEXT"},
    "transactions": {
        "client_ip": "TEXT",
        "latitude": "REAL",
        "longitude": "REAL",
        "city": "TEXT",
        "country": "TEXT",
        "location_source": "TEXT",
        "session_duration_seconds": "INTEGER",
        "auth_method": "TEXT",
        "typing_speed_ms": "REAL",
        "paste_detected": "INTEGER",
        "time_to_submit_seconds": "REAL",
        "client_timestamp": "TEXT",
        "client_timezone": "TEXT",
        "institution_id": "TEXT",
        # The recipient's real resolved name (Paystack NUBAN lookup). Display
        # was previously reconstructed from recipient_id, a lowercased slug,
        # so the actual account holder's name never survived the round trip.
        "recipient_name": "TEXT",
        # Client-generated id for offline transfers. A queued transfer is
        # replayed on reconnect, and without a stable reference each retry
        # would book a fresh row — the customer's history would grow every
        # time the network flapped.
        "client_reference": "TEXT",
        # Real Shield decision latency. The dashboard reported a hardcoded
        # p50/p95/p99 that was never measured from anything.
        "latency_ms": "REAL",
        # Time to the verdict alone, with the explanation write-up excluded.
        # latency_ms mixed the two, so a 4-second GPT-4o call was reported as
        # decision time and the console showed a ~4000ms p95 against a 200ms
        # budget. A payment rail waits for the verdict, not the prose, so the
        # budget is measured against this column. Left NULL on older rows,
        # which were genuinely measured a different way and must not be
        # silently folded into the same percentile.
        "decision_ms": "REAL",
        # The explanation and how it was produced, so a decision can always be
        # re-read with the prose that accompanied it.
        "explanation": "TEXT",
        "explanation_ms": "REAL",
        "explanation_source": "TEXT",
        # The transfer's lifecycle outcome, distinct from action_taken (the
        # decision). A BLOCK the customer contained and released ends
        # 'released'; a FLAG they verified ends 'completed'. Without this the
        # console re-derived status naively from the action and every override
        # was invisible after a refresh.
        "status": "TEXT",
        # Analyst review. action_taken is what Shield decided; these record what
        # a person at the bank concluded about it, and who.
        "review_state": "TEXT",
        "review_outcome": "TEXT",
        "assignee": "TEXT",
        "reviewed_by": "TEXT",
        "reviewed_at": "TEXT",
        # How the score was built, as weight coefficients plus fixed parts
        # (agents/shield/weights.py), so a backtest re-scores it exactly under
        # other weights. NULL on rows from before this was recorded.
        "score_parts": "TEXT",
        # Which engine version scored the transfer, and the SHA-256 of the
        # parameters actually in force (environment included).
        "engine_version": "INTEGER",
        "engine_params_hash": "TEXT",
        # The shadow version's verdict on the same signals, never acted on.
        "shadow_version": "INTEGER",
        "shadow_action": "TEXT",
        "shadow_score": "REAL",
    },
    "ghost_containers": {
        "institution_id": "TEXT",
        # The signals that caused the hold. Needed at release time: a container
        # held because of an unfamiliar device demands a stronger factor than
        # one held purely on amount.
        "signals": "TEXT",
        # The decision the hold was opened from. Risk and signals are copied
        # from it, never taken from the caller.
        "transaction_id": "TEXT",
        # Who resolved it: the customer, staff at the bank, or the expiry job.
        "resolved_by": "TEXT",
        "resolution_note": "TEXT",
    },
    "api_keys": {
        "institution_id": "TEXT",
        # Keys are stored as a hash (see apikeys.py). These keep enough of the
        # original to recognise it in the console: "fbl_live_9c2a" and "4a91".
        "key_prefix": "TEXT",
        "key_last4": "TEXT",
    },
    "institutions": {
        # Which add-on agents this bank has enabled. The per-customer columns
        # on fable_users were never read by anything, and the console's toggles
        # are institution-wide, so the setting belongs here.
        "agents_disabled": "TEXT",
        # sandbox: anyone may score against it by name (the public demo bank).
        # live: every write must carry this institution's API key.
        "mode": "TEXT DEFAULT 'sandbox'",
        # active, or suspended by a Fable operator. A suspended bank's console,
        # keys and sandbox are refused until it is reactivated.
        "status": "TEXT DEFAULT 'active'",
        "suspended_reason": "TEXT",
        "suspended_at": "TEXT",
        # When an owner confirmed the data processing agreement and the DPIA,
        # which going live requires (NDPA 2023, GAID 2025).
        "agreements_confirmed_at": "TEXT",
        "agreements_confirmed_by": "TEXT",
    },
    "admins": {
        # owner: everything. analyst: review work and reads. viewer: reads.
        # Existing admins were the only person at their bank, so they own it.
        "role": "TEXT DEFAULT 'owner'",
        "name": "TEXT",
        "active": "INTEGER DEFAULT 1",
        # Bumped on a password change or reset. Every session carries the value
        # it was issued with, so bumping it ends all of them at once.
        "session_version": "INTEGER DEFAULT 0",
    },
    "audit_log": {
        # Scoping audit events by joining through transactions missed anything
        # whose user had containers but no transfers, which is exactly the
        # containment activity a compliance view most needs to see.
        "institution_id": "TEXT",
    },
    "device_profiles": {
        # A device the customer explicitly trusted by enrolling a passkey on it.
        # Such a device counts as "known" for the device-anomaly signal even
        # before a transfer from it has settled — enrolling device unlock is a
        # deliberate act of trust, so future transfers from it aren't treated as
        # coming from a stranger.
        "trusted": "INTEGER DEFAULT 0",
    },
    "user_security": {
        # The customer chose not to share their location: it is neither
        # collected by the sandbox app nor stored or scored (location_anomaly
        # cannot fire for them).
        "location_opt_out": "INTEGER DEFAULT 0",
        # How many digits the stored PIN has, so the entry boxes match it even
        # if the configured length changes later.
        "pin_length": "INTEGER",
        # The customer's own out-of-band channels. Until now a verification
        # code fell back to the *institution's* contact address, which the
        # customer doesn't control — so "a code was sent to your email" wasn't
        # true. These let a customer register where their codes actually go.
        "contact_email": "TEXT",
        "contact_phone": "TEXT",
        # When each contact was last set. A code sent to an address that was
        # only just added cannot release held money. NULL means the contact
        # predates the column and counts as long-standing.
        "contact_email_set_at": "TEXT",
        "contact_phone_set_at": "TEXT",
        # A new address waits here until the customer proves they receive
        # mail at it; only then does it become contact_email.
        "pending_email": "TEXT",
        # A phone number counts as a channel for codes only once the customer
        # entered the code sent to it. Phones stored before this existed were
        # never confirmed, so they stay on file but are not a factor.
        "pending_phone": "TEXT",
        "contact_phone_verified_at": "TEXT",
    },
    "institution_settings": {
        # 1 lets a customer route a flagged transfer into a hold as well as a
        # blocked one (services/policy.py). NULL or 0: blocks only.
        "hold_on_flag": "INTEGER",
        # 1 lets analysts (not only owners) release a held transfer from the
        # console, with a note. NULL or 0: owners only.
        "analysts_can_release": "INTEGER",
    },
    "stepup_failures": {"institution_id": "TEXT"},
    "user_locations": {"institution_id": "TEXT"},
    "webhooks": {
        # The signing secret, envelope-encrypted with the master key
        # (core/secrets.seal). The plaintext column is emptied once sealed.
        "secret_ciphertext": "BLOB",
        "secret_nonce": "BLOB",
        "secret_wrapped": "BLOB",
        "secret_kid": "TEXT",
    },
    "stepup_challenges": {
        # Which channel a code went out on (email or sms), so the factor is
        # judged by when that contact was confirmed.
        "channel": "TEXT",
        "institution_id": "TEXT",
    },
    "stepup_tokens": {
        # Which factors the token proves, and when each was enrolled (JSON), so
        # a release can refuse factors set up after the money was held.
        "factors": "TEXT",
        "institution_id": "TEXT",
    },
}


def _migrate(conn):
    for table, columns in MIGRATIONS.items():
        existing = {row[1] for row in conn.execute(f"PRAGMA table_info({table})").fetchall()}
        if not existing:
            continue  # table not created yet; SCHEMA handles it
        for column, col_type in columns.items():
            if column not in existing:
                conn.execute(f"ALTER TABLE {table} ADD COLUMN {column} {col_type}")

    # The pre-multi-tenancy backfills that assigned unattributed rows to a
    # default 'meridian' tenant are gone with that tenant. They ran on every
    # start for months, so no deployment still has rows waiting for them.
    _drop_legacy_default(conn)

    # Existing API keys predate institution_id; derive it from the stored name.
    for row in conn.execute(
        "SELECT key, institution_name FROM api_keys WHERE institution_id IS NULL"
    ).fetchall():
        conn.execute(
            "UPDATE api_keys SET institution_id = ? WHERE key = ?",
            (slugify_institution(row[1]), row[0]),
        )

    # Keys used to be stored in plain text, so a copy of the database or any
    # backup held every institution's working key. Convert them to hashes in
    # place. Integrations keep working: the same key hashes to the same value.
    from core import apikeys

    converted = apikeys.hash_existing(conn)
    if converted:
        logger.info("Stored %d API key(s) as hashes instead of plain text.", converted)

    # Step-up tokens were stored as issued. Store the hash instead, in place:
    # a token still in flight keeps working, because it hashes to the new key.
    import hashlib

    for (raw,) in conn.execute("SELECT token FROM stepup_tokens WHERE token LIKE 'su\\_%' ESCAPE '\\'").fetchall():
        conn.execute("UPDATE OR IGNORE stepup_tokens SET token = ? WHERE token = ?",
                     ("h:" + hashlib.sha256(raw.encode()).hexdigest(), raw))

    conn.execute(
        """UPDATE transactions SET review_state = 'open'
           WHERE review_state IS NULL AND action_taken IN ('FLAG', 'BLOCK')"""
    )

    _backfill_customers(conn)
    _create_history_view(conn)
    _create_dataset_view(conn)
    _backfill_customer_devices(conn)
    _seal_webhook_secrets(conn)

    from core import privacy

    coarsened = privacy.backfill_precision(conn)
    if coarsened:
        logger.info("Coarsened the stored location or IP address on %d row(s).", coarsened)

    # No institution is created here. One used to be inserted into an empty
    # database; institutions now come only from provisioning.
    conn.commit()


HISTORY_COLUMNS = (
    "user_id, institution_id, amount, recipient_account, channel, device_fingerprint, "
    "city, country, hour_of_day, confirmed_legitimate, created_at"
)


def _create_history_view(conn) -> None:
    """Live decisions and imported history, as one stream for the baselines.

    Rebuilt on every start, because a view cannot be altered and its columns
    have to exist before it is created (some arrive by migration).
    """
    conn.execute("DROP VIEW IF EXISTS customer_history")
    conn.execute(
        f"""CREATE VIEW customer_history AS
            SELECT {HISTORY_COLUMNS}, client_timezone, session_duration_seconds,
                   time_to_submit_seconds, 'live' AS origin
              FROM transactions
            UNION ALL
            SELECT {HISTORY_COLUMNS}, NULL, NULL, NULL, 'import' AS origin
              FROM transaction_history"""
    )
    conn.commit()


def _create_dataset_view(conn) -> None:
    """Each decision's feature snapshot with its outcome and the analyst's label
    as they stand now. The label changes after the decision, so it is joined,
    never copied into the snapshot."""
    conn.execute("DROP VIEW IF EXISTS decision_dataset")
    conn.execute(
        """CREATE VIEW decision_dataset AS
           SELECT f.transaction_id, f.user_id, f.institution_id, f.feature_version, f.features, f.created_at,
                  t.action_taken, t.risk_score, t.score_parts, t.engine_version, t.review_outcome, t.status
             FROM decision_features f JOIN transactions t ON t.id = f.transaction_id"""
    )
    conn.commit()


def _backfill_customers(conn) -> None:
    """Give every customer that predates the customers table a row in it.

    The id stays the user_id the rows already use, so no history moves, and the
    bank's reference starts out as that same value. Customers created before
    this were sandbox customers, so they are marked as test customers. Runs on
    every start and only inserts what is missing.
    """
    rows = conn.execute(
        """SELECT user_id, institution_id FROM (
               SELECT user_id, institution_id FROM fable_users
               UNION SELECT user_id, institution_id FROM accounts
               UNION SELECT user_id, institution_id FROM transactions
           )
           WHERE user_id IS NOT NULL AND institution_id IS NOT NULL
             AND substr(user_id, 1, 7) != 'erased_'
             AND user_id NOT IN (SELECT id FROM customers)"""
    ).fetchall()
    added = 0
    for user_id, institution_id in rows:
        cur = conn.execute(
            """INSERT OR IGNORE INTO customers
                   (id, institution_id, external_ref, display_name, kind, source)
               VALUES (?, ?, ?, ?, 'test', 'console')""",
            (user_id, institution_id, user_id, None),
        )
        added += cur.rowcount
    conn.commit()
    if added:
        logger.info("Recorded %d existing customer(s) in the customers table.", added)


def _backfill_customer_devices(conn) -> None:
    """Copy device_profiles rows into customer_devices, once each.

    Idempotent (INSERT OR IGNORE on the composite key). Each old row belongs to
    the customer it was first recorded for, which is the only owner it ever
    had; trust built by other customers' traffic cannot be told apart, so it
    is carried over as it stands.
    """
    try:
        conn.execute(
            """INSERT OR IGNORE INTO customer_devices
                 (user_id, institution_id, fingerprint_id, platform, os, browser, screen, gpu, language, timezone,
                  touch_support, first_seen, last_seen, times_seen, trust_score, trusted)
               SELECT d.user_id, c.institution_id, d.fingerprint_id, d.platform, d.os, d.browser, d.screen, d.gpu,
                      d.language, d.timezone, d.touch_support, d.first_seen, d.last_seen, d.times_seen,
                      d.trust_score, COALESCE(d.trusted, 0)
               FROM device_profiles d LEFT JOIN customers c ON c.id = d.user_id"""
        )
    except sqlite3.OperationalError as exc:
        logger.warning("Could not copy device profiles: %s", exc)


def _seal_webhook_secrets(conn) -> None:
    """Encrypt webhook signing secrets still stored in plain text.

    Needs the master key; without it the secrets stay as they are (the same
    as before) and the startup log says so. Idempotent: only rows with a
    plaintext secret and no ciphertext are touched.
    """
    from core import secrets as vault

    rows = conn.execute(
        "SELECT id, secret FROM webhooks WHERE COALESCE(secret, '') != '' AND secret_ciphertext IS NULL"
    ).fetchall()
    if not rows:
        return
    if vault.master_key() is None:
        logger.warning("%d webhook signing secret(s) are stored in plain text: set FABLE_SECRETS_KEY to encrypt them.",
                       len(rows))
        return
    for hook_id, secret in rows:
        sealed = vault.seal(secret, f"webhook:{hook_id}", 1, "webhook")
        conn.execute(
            """UPDATE webhooks SET secret_ciphertext = ?, secret_nonce = ?, secret_wrapped = ?, secret_kid = ?,
                      secret = '' WHERE id = ? AND secret_ciphertext IS NULL""",
            (sealed["ciphertext"], sealed["nonce"], sealed["wrapped_key"], sealed["kid"], hook_id),
        )
    logger.info("Encrypted %d webhook signing secret(s).", len(rows))


def require_institution_id(institution_id: str | None) -> str:
    """Every row belongs to a named institution; refuse to write one without.

    A default tenant used to be filled in here, so a caller that forgot the
    institution wrote rows onto a bank that might not exist.
    """
    if not institution_id:
        raise ValueError("institution_id is required: every row belongs to a named institution.")
    return institution_id


LEGACY_DEFAULT = "DEFAULT 'meridian'"


def _drop_legacy_default(conn) -> None:
    """Remove the old `DEFAULT 'meridian'` from tables created with it.

    SQLite cannot alter a column's default, so a table that still has one is
    rebuilt the way SQLite's documentation prescribes: create the new shape,
    copy every row, drop the old table, rename, and recreate its indexes, all in
    one transaction so a failure leaves the original untouched. Tables without
    the default (the usual case) are not touched at all.
    """
    tables = conn.execute(
        "SELECT name, sql FROM sqlite_master WHERE type = 'table' AND sql LIKE ?",
        (f"%{LEGACY_DEFAULT}%",),
    ).fetchall()
    if not tables:
        return

    conn.commit()
    conn.execute("BEGIN IMMEDIATE")
    try:
        for name, sql in tables:
            temp = f"{name}__rebuild"
            indexes = [
                row[0]
                for row in conn.execute(
                    "SELECT sql FROM sqlite_master WHERE type = 'index' AND tbl_name = ? AND sql IS NOT NULL",
                    (name,),
                )
            ]
            head, rest = sql.split("(", 1)
            conn.execute(f'CREATE TABLE "{temp}" (' + rest.replace(" " + LEGACY_DEFAULT, ""))
            columns = ", ".join(f'"{row[1]}"' for row in conn.execute(f'PRAGMA table_info("{name}")'))
            conn.execute(f'INSERT INTO "{temp}" ({columns}) SELECT {columns} FROM "{name}"')
            conn.execute(f'DROP TABLE "{name}"')
            conn.execute(f'ALTER TABLE "{temp}" RENAME TO "{name}"')
            for index_sql in indexes:
                conn.execute(index_sql)
            logger.info("Removed the legacy 'meridian' default from %s.", name)
        conn.execute("COMMIT")
    except Exception:
        conn.execute("ROLLBACK")
        raise


def slugify_institution(name: str) -> str:
    """Institution display name -> stable id used in URLs and row tags."""
    return "".join(c if c.isalnum() else "_" for c in name.strip().lower()).strip("_")


# Indexes. The schema shipped with none, so every query below was a full table
# scan: the per-customer baseline and the velocity count on *every* decision,
# held_amount on every balance read, and every dashboard rollup. Separate from
# SCHEMA because a unique index can fail on existing data and has to be handled
# on its own — see _create_indexes.
INDEXES = """
CREATE INDEX IF NOT EXISTS ix_txn_user_created   ON transactions(user_id, created_at);
CREATE INDEX IF NOT EXISTS ix_features_user      ON decision_features(user_id);
CREATE INDEX IF NOT EXISTS ix_txn_inst_created   ON transactions(institution_id, created_at);
CREATE INDEX IF NOT EXISTS ix_txn_user_conf      ON transactions(user_id, confirmed_legitimate, created_at);
CREATE INDEX IF NOT EXISTS ix_txn_action         ON transactions(action_taken);
CREATE INDEX IF NOT EXISTS ix_txn_created        ON transactions(created_at);
CREATE INDEX IF NOT EXISTS ix_ghost_user_status  ON ghost_containers(user_id, status);
CREATE INDEX IF NOT EXISTS ix_ghost_inst_status  ON ghost_containers(institution_id, status);
CREATE INDEX IF NOT EXISTS ix_ledger_user        ON ledger_entries(user_id);
CREATE INDEX IF NOT EXISTS ix_locations_user     ON user_locations(user_id);
CREATE INDEX IF NOT EXISTS ix_devices_user       ON device_profiles(user_id);
CREATE INDEX IF NOT EXISTS ix_failures_user_time ON stepup_failures(user_id, created_at);
CREATE INDEX IF NOT EXISTS ix_challenges_user    ON stepup_challenges(user_id);
CREATE INDEX IF NOT EXISTS ix_notifs_user_time   ON notifications(user_id, created_at);
CREATE INDEX IF NOT EXISTS ix_txn_inst_review    ON transactions(institution_id, review_state);
CREATE INDEX IF NOT EXISTS ix_login_fail_email   ON login_failures(email, at);
CREATE INDEX IF NOT EXISTS ix_login_fail_ip      ON login_failures(ip, at);
CREATE INDEX IF NOT EXISTS ix_notes_txn          ON case_notes(transaction_id);
CREATE INDEX IF NOT EXISTS ix_hooks_inst         ON webhooks(institution_id);
CREATE INDEX IF NOT EXISTS ix_deliveries_hook    ON webhook_deliveries(webhook_id, created_at);
CREATE INDEX IF NOT EXISTS ix_customers_inst     ON customers(institution_id, kind, status);
CREATE INDEX IF NOT EXISTS ix_history_user       ON transaction_history(user_id, created_at);
CREATE INDEX IF NOT EXISTS ix_history_inst       ON transaction_history(institution_id, created_at);
CREATE INDEX IF NOT EXISTS ix_import_rows_job    ON import_rows(job_id, line);
CREATE INDEX IF NOT EXISTS ix_import_jobs_inst   ON import_jobs(institution_id, created_at);
CREATE INDEX IF NOT EXISTS ix_txn_inst_clientref ON transactions(institution_id, client_reference);
CREATE INDEX IF NOT EXISTS ix_outbox_due         ON webhook_outbox(status, next_attempt_at);
CREATE INDEX IF NOT EXISTS ix_ghost_expiry       ON ghost_containers(status, expires_at);
CREATE INDEX IF NOT EXISTS ix_ghost_txn          ON ghost_containers(transaction_id);
CREATE INDEX IF NOT EXISTS ix_inbox_user         ON sandbox_inbox(user_id, id);
CREATE INDEX IF NOT EXISTS ix_devices_customer   ON customer_devices(user_id);
"""

# Offline-replay idempotency rests entirely on client_reference, and the lookup
# in routers/shield.py uses fetchone(), but nothing stopped duplicates: the
# column arrived via ALTER TABLE, where SQLite cannot add a constraint. A
# partial unique index does the job and tolerates the many NULLs (every
# online transfer has none). ledger_entries.reference got this right from the
# start with a plain UNIQUE.
# Unique per bank, not globally: two banks may use the same reference for
# their own transfers. The old global index made the second bank's insert fail
# with a 500 and told it the reference existed elsewhere.
CLIENT_REF_INDEX = (
    "CREATE UNIQUE INDEX IF NOT EXISTS ux_txn_inst_client_ref "
    "ON transactions(institution_id, client_reference) WHERE client_reference IS NOT NULL"
)


def _create_indexes(conn) -> None:
    conn.executescript(INDEXES)
    try:
        conn.execute(CLIENT_REF_INDEX)
        # The per-bank index is in place, so the global one can go.
        conn.execute("DROP INDEX IF EXISTS ux_txn_client_ref")
    except sqlite3.IntegrityError:
        # Pre-existing duplicates from before the constraint existed. Log and
        # continue rather than refusing to boot: the index is a guard against
        # future double-booking, and blocking startup over historical rows
        # would take the whole API down to fix a data problem.
        logger.warning(
            "Duplicate client_reference values already exist, so the unique "
            "index was not created. De-duplicate transactions, keeping the "
            "earliest row per reference, then restart to enforce it."
        )
    conn.commit()


def _ensure_initialized(conn) -> None:
    """Create schema, migrate and index exactly once per process."""
    global _initialized
    if _initialized:
        return
    with _init_lock:
        if _initialized:
            return
        conn.executescript(SCHEMA)
        conn.commit()
        _migrate(conn)
        _create_indexes(conn)
        _initialized = True


def get_conn():
    if not hasattr(_local, "conn"):
        conn = sqlite3.connect(DB_PATH, check_same_thread=False)
        conn.row_factory = sqlite3.Row
        # Order matters. busy_timeout is per connection and must be set FIRST,
        # because switching journal_mode briefly needs an exclusive lock: with
        # no timeout in effect, several threads opening connections at once
        # made that PRAGMA fail outright with "database is locked" rather than
        # waiting its turn.
        conn.execute("PRAGMA busy_timeout=5000")
        # WAL lets readers run while a writer holds the lock, which matters
        # because the scoring path issues several reads per decision. It is a
        # persistent property of the database file, so this is a no-op after
        # the first connection ever made to it.
        conn.execute("PRAGMA journal_mode=WAL")
        _ensure_initialized(conn)
        _local.conn = conn
    return _local.conn


@contextmanager
def cursor():
    conn = get_conn()
    cur = conn.cursor()
    try:
        yield cur
        conn.commit()
    finally:
        cur.close()


def row_to_dict(row):
    if row is None:
        return None
    d = dict(row)
    return d


def dumps(obj):
    return json.dumps(obj, default=str)


def loads(s, default=None):
    if not s:
        return default
    try:
        return json.loads(s)
    except (TypeError, ValueError):
        return default
