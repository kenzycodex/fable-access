"""Move Shield's FABLE_W_* weights and thresholds from api/.env to the Engine page.

Version 1 is seeded from the environment on first boot, so usually the values
are already stored and this only confirms it and lists the lines to delete.
If a value in .env differs from the live version (it was changed after
seeding), --apply records a new live version with the .env values, so
nothing changes when the lines are deleted. Version 1 itself is never
rewritten: decisions already carry its hash.

Weights (FABLE_W_*), channel risk weights (FABLE_CHANNEL_*) and thresholds
move. FABLE_VELOCITY_*, FABLE_TENURE_* and FABLE_RECIPIENT_MEMORY_DAYS are
Environment settings instead: move them with scripts/import_env_secrets.py.

    # 1. See what would move:
    docker compose exec -T api python scripts/import_env_engine.py
    # 2. Store any value that differs:
    docker compose exec -T api python scripts/import_env_engine.py --apply
    # 3. Delete exactly the stored lines, then recreate:
    NAMES=$(docker compose exec -T api python scripts/import_env_engine.py --stored | tr -d '\\r')
    sed -i -E "/^($NAMES)=/d" .env && docker compose up -d --force-recreate
"""
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))


def main() -> int:
    from core import engine_config
    from core.db import cursor
    from services.secret_admin import log_event

    engine_config.seed_if_empty()
    with cursor() as cur:
        cur.execute("SELECT version, params FROM engine_versions WHERE status = 'active' ORDER BY version DESC LIMIT 1")
        row = cur.fetchone()
    live, stored = row["version"], engine_config.normalise(json.loads(row["params"]))
    current = engine_config.flat(stored)
    overrides = engine_config.env_overrides()
    same = {p: v for p, v in overrides.items() if abs(current[p] - v) < 1e-9}
    differ = {p: v for p, v in overrides.items() if p not in same}

    if "--stored" in sys.argv:
        # The .env names whose value the live version already holds, pipe-separated.
        print("|".join(sorted(engine_config.env_name(p) for p in same)))
        return 0

    if "--apply" in sys.argv and differ:
        params = engine_config.apply_env(stored, differ)
        errors = engine_config.validate(params)
        if errors:
            print("Not stored: the .env values are outside the Engine page's bounds:")
            for e in errors:
                print(f"  {e}")
            return 1
        digest = engine_config.params_hash(params)
        with cursor() as cur:
            cur.execute("SELECT COALESCE(MAX(version), 0) + 1 AS v FROM engine_versions")
            version = cur.fetchone()["v"]
            cur.execute("UPDATE engine_versions SET status = 'retired', retired_at = datetime('now') WHERE status = 'active'")
            cur.execute("UPDATE engine_activations SET ended_at = datetime('now') WHERE ended_at IS NULL")
            cur.execute(
                """INSERT INTO engine_versions (version, status, params, params_hash, approved_hash, base_version, note,
                     created_by, approved_by, approved_at, activated_at, activated_by)
                   VALUES (?, 'active', ?, ?, ?, ?, 'Imported from the server environment.', 'server import',
                           'server import', datetime('now'), datetime('now'), 'server import')""",
                (version, engine_config.canonical(params), digest, digest, live),
            )
            cur.execute("INSERT INTO engine_activations (version, started_at, by, kind) "
                        "VALUES (?, datetime('now'), 'server import', 'import')", (version,))
        engine_config.bump_generation()
        log_event("engine.imported_from_environment", actor="server script", name="engine", version=version,
                  detail={"from_version": live, "params_hash": digest,
                          "changes": engine_config.changes(stored, params)})
        print(f"Stored {len(differ)} value(s) as v{version}, now live (it scores exactly as .env did):")
        for p, v in sorted(differ.items()):
            print(f"  {engine_config.env_name(p)} = {v}")
        same.update(differ)
        differ = {}
        live = version

    print(f"Live version: v{live}" if not differ else f"Live version: v{live} (differs from .env)")
    print(f"Already stored, safe to delete from .env ({len(same)}):")
    for p in sorted(same):
        print(f"  {engine_config.env_name(p)}")
    if differ:
        print(f"Differ from the live version ({len(differ)}). Run with --apply to store them first:")
        for p, v in sorted(differ.items()):
            print(f"  {engine_config.env_name(p)} = {v} (stored in v{live}: {current[p]}; .env wins until then)")
    elif same:
        print("Delete those lines (scripts/import_env_engine.py --stored lists them), then: "
              "docker compose up -d --force-recreate")
    return 0


if __name__ == "__main__":
    sys.exit(main())
