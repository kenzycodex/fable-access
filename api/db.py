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
"""

# Columns added to `transactions` after the original schema shipped. Existing
# fable.db files are upgraded in place at boot via PRAGMA table_info diffing.
TRANSACTIONS_MIGRATIONS = {
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
}


def _migrate(conn):
    cur = conn.execute("PRAGMA table_info(transactions)")
    existing = {row[1] for row in cur.fetchall()}
    for column, col_type in TRANSACTIONS_MIGRATIONS.items():
        if column not in existing:
            conn.execute(f"ALTER TABLE transactions ADD COLUMN {column} {col_type}")
    conn.commit()


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
