"""Move integration keys from api/.env into the operator console's store.

Only the keys the console manages (core/secrets.MANAGED: AI provider keys and
models, address-lookup keys) are moved. Everything else stays in .env for
good: the session secret, the master key, the PIN pepper, SMTP, CORS, URLs.

The values go straight from the environment into encrypted storage on the
server. They never pass through a browser or a terminal printout.

    # 1. FABLE_SECRETS_KEY must already be set in .env (and the API restarted).
    # 2. See what would move:
    docker compose exec -T api python scripts/import_env_secrets.py
    # 3. Move them:
    docker compose exec -T api python scripts/import_env_secrets.py --apply
    # 4. Delete those lines from .env, then: docker compose up -d --force-recreate
    #    (The environment wins while a key is still in .env.)
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))


def main() -> int:
    from core import secrets as vault
    from core.db import cursor
    from services.secret_admin import log_event

    apply = "--apply" in sys.argv
    if vault.master_key() is None:
        print("FABLE_SECRETS_KEY is not set (or is not 32 bytes). Set it in .env and restart first.")
        return 1

    moved, skipped = [], []
    for name, spec in vault.MANAGED.items():
        value = vault.env_value(name)
        if not value:
            continue
        with cursor() as cur:
            cur.execute("SELECT 1 FROM platform_secrets WHERE name = ? AND status = 'active'", (name,))
            if cur.fetchone():
                skipped.append(f"{name} (already stored in the console)")
                continue
        if spec.kind == "model" and value not in vault.allowed_models(name):
            skipped.append(f"{name} ({value} is not on the model allowlist; add it to FABLE_MODEL_ALLOWLIST first)")
            continue
        if apply:
            with cursor() as cur:
                cur.execute("SELECT COALESCE(MAX(version), 0) + 1 AS v FROM platform_secrets WHERE name = ?", (name,))
                version = cur.fetchone()["v"]
                sealed = vault.seal(value, name, version)
                cur.execute(
                    """INSERT INTO platform_secrets (name, version, status, ciphertext, nonce, wrapped_key, kid, last4,
                         fingerprint, rotation_reason, set_by, approved_by)
                       VALUES (?, ?, 'active', ?, ?, ?, ?, ?, ?, 'initial', 'server import', 'server import')""",
                    (name, version, sealed["ciphertext"], sealed["nonce"], sealed["wrapped_key"], sealed["kid"],
                     vault.last4(value, spec.kind), vault.fingerprint(value)),
                )
            log_event("secret.imported_from_environment", actor="server script", name=name, version=version,
                      detail={"fingerprint": vault.fingerprint(value)})
        moved.append(f"{name} ({vault.last4(value, spec.kind)})")

    if apply and moved:
        vault.bump_generation()
    print(("Moved" if apply else "Would move") + f" {len(moved)} key(s):")
    for line in moved:
        print(f"  {line}")
    for line in skipped:
        print(f"  skipped: {line}")
    if apply and moved:
        print("Now delete those lines from .env and run: docker compose up -d --force-recreate")
    elif moved:
        print("Run again with --apply to move them.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
