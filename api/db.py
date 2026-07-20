"""SQLite-backed persistence layer.

Mirrors the Supabase/Postgres schema from the implementation doc
(fable_users, transactions, ghost_containers, audit_log) so this can be
swapped for a real Supabase client later without changing agent logic.
"""
import json
import sqlite3
import threading
from contextlib import contextmanager

from config import DB_PATH

_local = threading.local()

SCHEMA = """
CREATE TABLE IF NOT EXISTS fable_users (
    user_id TEXT PRIMARY KEY,
    institution_id TEXT DEFAULT 'demo_bank',
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
    conn.execute(
        "UPDATE ghost_containers SET institution_id = ? WHERE institution_id IS NULL",
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


def get_conn():
    if not hasattr(_local, "conn"):
        conn = sqlite3.connect(DB_PATH, check_same_thread=False)
        conn.row_factory = sqlite3.Row
        conn.executescript(SCHEMA)
        conn.commit()
        _migrate(conn)
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
