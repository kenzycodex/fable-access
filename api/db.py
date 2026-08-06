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

from config import DB_PATH

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
    -- 'demo_bank' used to be the default here and hardcoded in the seed
    -- endpoint, while DEFAULT_INSTITUTION_ID is 'meridian'. No institutions row
    -- has ever existed for 'demo_bank', so anything created through that path
    -- was orphaned to a tenant no dashboard could select.
    institution_id TEXT DEFAULT 'meridian',
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

CREATE TABLE IF NOT EXISTS institutions (
    institution_id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    type TEXT DEFAULT 'Microfinance Bank',
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
"""

# The tenant every pre-multi-tenant row belongs to. Existing databases were
# single-tenant, so their history is backfilled to this institution.
DEFAULT_INSTITUTION_ID = "meridian"

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

    # Backfill: pre-multi-tenant rows all belong to the original tenant.
    conn.execute(
        "UPDATE transactions SET institution_id = ? WHERE institution_id IS NULL",
        (DEFAULT_INSTITUTION_ID,),
    )
    # Scoped to containers whose owner genuinely belongs to the default tenant.
    #
    # This was an unconditional claim on every NULL, which turned a one-off
    # backfill into a permanent trap: seeding wrote containers with no tenant,
    # and the next startup handed all of them to the default institution
    # regardless of which bank they belonged to. One bank's "fraud prevented"
    # appeared on another's dashboard. The insert is fixed, so this now only
    # has genuine pre-multi-tenancy rows to catch, and it can no longer take a
    # container whose transactions point elsewhere.
    conn.execute(
        """UPDATE ghost_containers SET institution_id = ?
           WHERE institution_id IS NULL
             AND user_id NOT IN (
                 SELECT DISTINCT user_id FROM transactions
                 WHERE institution_id IS NOT NULL AND institution_id != ?
             )""",
        (DEFAULT_INSTITUTION_ID, DEFAULT_INSTITUTION_ID),
    )
    # Legacy rows from when the schema defaulted to a tenant that never existed.
    conn.execute(
        "UPDATE fable_users SET institution_id = ? WHERE institution_id = 'demo_bank'",
        (DEFAULT_INSTITUTION_ID,),
    )
    # Existing API keys predate institution_id; derive it from the stored name.
    for row in conn.execute(
        "SELECT key, institution_name FROM api_keys WHERE institution_id IS NULL"
    ).fetchall():
        conn.execute(
            "UPDATE api_keys SET institution_id = ? WHERE key = ?",
            (slugify_institution(row[1]), row[0]),
        )

    conn.execute(
        """INSERT OR IGNORE INTO institutions (institution_id, name, type, contact_email)
           VALUES (?, 'Meridian MFB', 'Microfinance Bank', 'risk@meridian.ng')""",
        (DEFAULT_INSTITUTION_ID,),
    )
    conn.commit()


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
