"""Admin password hashing.

Previously a single round of SHA-256 with a salt, compared with `==`. Two
problems, and the second is the one that stings:

- One SHA-256 round is trivially brute-forced on a GPU. Password hashing needs
  to be *deliberately* slow; a general-purpose digest is the opposite.
- `==` on a hex digest short-circuits, so comparison time leaks how many
  leading characters matched.

The inconsistency was the tell: the customer's four-digit transaction PIN was
already protected with PBKDF2 at 200,000 rounds and `hmac.compare_digest`, with
a comment explaining the timing risk, while the password guarding an entire
institution's console had neither. This brings the admin password up to the
same standard the PIN already met.

Existing `salt:hash` values still verify, and are transparently upgraded to the
new format on the next successful login, so nobody is locked out by the change.
"""
import hashlib
import hmac
import secrets

PBKDF2_ROUNDS = 200_000
_ALGO = "pbkdf2_sha256"


def hash_password(password: str) -> str:
    """`pbkdf2_sha256$rounds$salt$hash`."""
    salt = secrets.token_hex(16)
    digest = hashlib.pbkdf2_hmac("sha256", password.encode(), salt.encode(), PBKDF2_ROUNDS).hex()
    return f"{_ALGO}${PBKDF2_ROUNDS}${salt}${digest}"


def verify_password(password: str, stored_hash: str) -> bool:
    """Verify against either the current format or the legacy one.

    Constant-time in both branches. Returns False rather than raising on a
    malformed stored value, because a corrupt row should fail the login, not
    the request.
    """
    if not stored_hash:
        return False

    if stored_hash.startswith(_ALGO + "$"):
        try:
            _, rounds, salt, digest = stored_hash.split("$", 3)
            computed = hashlib.pbkdf2_hmac(
                "sha256", password.encode(), salt.encode(), int(rounds)
            ).hex()
        except (ValueError, TypeError):
            return False
        return hmac.compare_digest(computed, digest)

    # Legacy `salt:sha256(password + salt)`. Still accepted so existing admins
    # can sign in; needs_rehash() tells the caller to upgrade them.
    try:
        salt, digest = stored_hash.split(":", 1)
    except ValueError:
        return False
    computed = hashlib.sha256((password + salt).encode("utf-8")).hexdigest()
    return hmac.compare_digest(computed, digest)


def needs_rehash(stored_hash: str) -> bool:
    """True when a stored hash predates the current algorithm."""
    return not (stored_hash or "").startswith(_ALGO + "$")
