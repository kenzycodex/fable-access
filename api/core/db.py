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
"""

# The tenant every pre-multi-tenant row belongs to. Existing databases were
# single-tenant, so their history is backfilled to this institution.

# Columns added after the original schema shipped. Existing fable.db files are
# upgraded in place at boot via PRAGMA table_info diffing.
MIGRATIONS = {
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
    },
    "ghost_containers": {
        "institution_id": "TEXT",
        # The signals that caused the hold. Needed at release time: a container
        # held because of an unfamiliar device demands a stronger factor than
        # one held purely on amount.
        "signals": "TEXT",
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
        # How many digits the stored PIN has, so the entry boxes match it even
        # if the configured length changes later.
        "pin_length": "INTEGER",
        # The customer's own out-of-band channels. Until now a verification
        # code fell back to the *institution's* contact address, which the
        # customer doesn't control — so "a code was sent to your email" wasn't
        # true. These let a customer register where their codes actually go.
        "contact_email": "TEXT",
        "contact_phone": "TEXT",
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

    conn.execute(
        """UPDATE transactions SET review_state = 'open'
           WHERE review_state IS NULL AND action_taken IN ('FLAG', 'BLOCK')"""
    )

    _backfill_customers(conn)

    # No institution is created here. One used to be inserted into an empty
    # database; institutions now come only from provisioning.
    conn.commit()


def _backfill_customers(conn) -> None:
    """Give every customer that predates the customers table a row in it.

    The id stays the user_id the rows already use, so no history moves, and the
    bank's reference starts out as that same value. Customers created before
    this were sandbox customers, so they are marked as test customers. Runs on
    every start and only inserts what is missing.
    """
    try:
        from agents.copilot.demo_customers import customer_name_for
    except Exception:  # noqa: BLE001 - names are a nicety, never a blocker
        def customer_name_for(_user_id):
            return None

    rows = conn.execute(
        """SELECT user_id, institution_id FROM (
               SELECT user_id, institution_id FROM fable_users
               UNION SELECT user_id, institution_id FROM accounts
               UNION SELECT user_id, institution_id FROM transactions
           )
           WHERE user_id IS NOT NULL AND institution_id IS NOT NULL
             AND user_id NOT IN (SELECT id FROM customers)"""
    ).fetchall()
    added = 0
    for user_id, institution_id in rows:
        cur = conn.execute(
            """INSERT OR IGNORE INTO customers
                   (id, institution_id, external_ref, display_name, kind, source)
               VALUES (?, ?, ?, ?, 'test', 'console')""",
            (user_id, institution_id, user_id, customer_name_for(user_id)),
        )
        added += cur.rowcount
    conn.commit()
    if added:
        logger.info("Recorded %d existing customer(s) in the customers table.", added)


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
CREATE INDEX IF NOT EXISTS ix_txn_inst_created   ON transactions(institution_id, created_at);
CREATE INDEX IF NOT EXISTS ix_txn_user_conf      ON transactions(user_id, confirmed_legitimate, created_at);
CREATE INDEX IF NOT EXISTS ix_txn_action         ON transactions(action_taken);
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
CREATE INDEX IF NOT EXISTS ix_txn_inst_clientref ON transactions(institution_id, client_reference);
"""

# Offline-replay idempotency rests entirely on client_reference, and the lookup
# in routers/shield.py uses fetchone(), but nothing stopped duplicates: the
# column arrived via ALTER TABLE, where SQLite cannot add a constraint. A
# partial unique index does the job and tolerates the many NULLs (every
# online transfer has none). ledger_entries.reference got this right from the
# start with a plain UNIQUE.
CLIENT_REF_INDEX = (
    "CREATE UNIQUE INDEX IF NOT EXISTS ux_txn_client_ref "
    "ON transactions(client_reference) WHERE client_reference IS NOT NULL"
)


def _create_indexes(conn) -> None:
    conn.executescript(INDEXES)
    try:
        conn.execute(CLIENT_REF_INDEX)
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
