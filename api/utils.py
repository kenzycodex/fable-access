import hashlib
import secrets

def hash_password(password: str) -> str:
    """Hash a password with a random salt for secure storage."""
    salt = secrets.token_hex(16)
    hashed = hashlib.sha256((password + salt).encode('utf-8')).hexdigest()
    return f"{salt}:{hashed}"

def verify_password(password: str, stored_hash: str) -> bool:
    """Verify a password against a stored salted hash."""
    try:
        salt, hashed = stored_hash.split(':')
        return hashed == hashlib.sha256((password + salt).encode('utf-8')).hexdigest()
    except ValueError:
        return False
