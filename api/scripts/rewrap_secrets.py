"""Rotate the master key (FABLE_SECRETS_KEY) without re-entering any key.

Every stored value has its own data key; only those data keys are wrapped by
the master key. This opens each one with the old master key and wraps it again
with the new one, inside one transaction, then checks every value opens.

    # 1. Generate a new master key and keep the old one:
    #    python3 -c "import secrets,base64;print(base64.urlsafe_b64encode(secrets.token_bytes(32)).decode())"
    # 2. Run, with both:
    docker compose exec -T -e OLD_KEY=... -e NEW_KEY=... -e NEW_KID=k2 api python scripts/rewrap_secrets.py
    # 3. Put the new key in .env as FABLE_SECRETS_KEY (and FABLE_SECRETS_KEY_ID=k2), restart.

Values are never printed. Proposed changes still waiting are re-wrapped too.
"""
import base64
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))


def _key(raw: str) -> bytes:
    key = base64.urlsafe_b64decode(raw + "=" * (-len(raw) % 4))
    if len(key) != 32:
        raise SystemExit("A master key must be 32 bytes, urlsafe base64.")
    return key


def main() -> int:
    from core import secrets as vault
    from core.db import cursor

    old, new = _key(os.environ["OLD_KEY"]), _key(os.environ["NEW_KEY"])
    kid = os.environ.get("NEW_KID", "k2")
    moved = 0
    with cursor() as cur:
        cur.execute("SELECT * FROM platform_secrets WHERE ciphertext IS NOT NULL")
        for row in [dict(r) for r in cur.fetchall()]:
            value = vault.open_sealed(row, row["name"], row["version"], key=old)
            sealed = vault.seal(value, row["name"], row["version"], key=new, kid=kid)
            cur.execute("UPDATE platform_secrets SET ciphertext = ?, nonce = ?, wrapped_key = ?, kid = ? WHERE name = ? AND version = ?",
                        (sealed["ciphertext"], sealed["nonce"], sealed["wrapped_key"], kid, row["name"], row["version"]))
            assert vault.open_sealed(sealed, row["name"], row["version"], key=new) == value
            moved += 1
        cur.execute("SELECT * FROM secret_changes WHERE ciphertext IS NOT NULL")
        for row in [dict(r) for r in cur.fetchall()]:
            value = vault.open_sealed(row, row["name"], row["id"], purpose="pending", key=old)
            sealed = vault.seal(value, row["name"], row["id"], purpose="pending", key=new, kid=kid)
            cur.execute("UPDATE secret_changes SET ciphertext = ?, nonce = ?, wrapped_key = ?, kid = ? WHERE id = ?",
                        (sealed["ciphertext"], sealed["nonce"], sealed["wrapped_key"], kid, row["id"]))
            moved += 1
    from services.secret_admin import log_event

    log_event("secret.master_key_rotated", actor="server script", detail={"kid": kid, "values": moved})
    print(f"Re-wrapped {moved} value(s) under key id {kid}. Now set FABLE_SECRETS_KEY and FABLE_SECRETS_KEY_ID={kid} and restart.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
