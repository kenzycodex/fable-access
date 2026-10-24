"""Institution API keys: issued once, stored only as a hash.

A key is `fbl_live_` plus 32 random hex characters. Only its SHA-256 hash is kept
(in `api_keys.key`, as `sha256:<hex>`), with the first 13 and last 4 characters
for display. Anyone who obtains a copy of the database or a backup therefore
holds no usable key.

A fast hash is the right tool here, unlike for passwords: the key is 128 bits of
randomness, so there is nothing to guess and no dictionary to precompute. This
is how payment and code-hosting providers store their API tokens.

The full key is shown exactly once, when it is issued (provisioning or rotation).
After that only the masked form exists. A lost key is replaced by rotating it.
"""
import hashlib
import secrets

PREFIX = "fbl_live_"
HASH_SCHEME = "sha256:"
_SHOWN_PREFIX = 13  # "fbl_live_" plus the first 4 random characters


def generate() -> str:
    return f"{PREFIX}{secrets.token_hex(16)}"


def hash_key(raw: str) -> str:
    return HASH_SCHEME + hashlib.sha256(raw.encode()).hexdigest()


def is_hashed(stored: str | None) -> bool:
    return bool(stored) and stored.startswith(HASH_SCHEME)


def display_parts(raw: str) -> tuple[str, str]:
    """(prefix, last4) to keep for display."""
    return raw[:_SHOWN_PREFIX], raw[-4:]


def mask(prefix: str | None, last4: str | None) -> str | None:
    """fbl_live_9c2a••••••••4a91: enough to recognise, not enough to use."""
    if not prefix or not last4:
        return None
    return f"{prefix}{'•' * 8}{last4}"


def insert(cur, raw: str, institution_id: str, institution_name: str, admin_email: str) -> None:
    """Store a newly issued key. Only its hash and display parts are kept."""
    prefix, last4 = display_parts(raw)
    cur.execute(
        """INSERT INTO api_keys (key, institution_name, admin_email, institution_id, key_prefix, key_last4)
           VALUES (?, ?, ?, ?, ?, ?)""",
        (hash_key(raw), institution_name, admin_email, institution_id, prefix, last4),
    )


def hash_existing(conn) -> int:
    """Convert any key still stored in plain text. Idempotent. Returns how many."""
    rows = conn.execute(f"SELECT key FROM api_keys WHERE key NOT LIKE '{HASH_SCHEME}%'").fetchall()
    for (raw,) in rows:
        prefix, last4 = display_parts(raw)
        conn.execute(
            "UPDATE api_keys SET key = ?, key_prefix = COALESCE(key_prefix, ?), key_last4 = COALESCE(key_last4, ?) WHERE key = ?",
            (hash_key(raw), prefix, last4, raw),
        )
    return len(rows)
