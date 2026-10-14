"""Test-wide setup.

Point the database at a throwaway file before anything imports Fable's config, so
no test run can ever read or write the real `api/fable.db`. Each test module also
sets its own path with setdefault, but this runs first, so those only matter when
a module is run on its own.
"""
import os
import tempfile

os.environ["FABLE_DB_PATH"] = os.path.join(tempfile.mkdtemp(prefix="fable-tests-"), "suite.db")
# Every TestClient request comes from the same address, so the whole suite would
# share one per-minute rate-limit bucket. The limiter has its own behaviour to
# test; elsewhere it only gets in the way.
os.environ.setdefault("FABLE_RATE_LIMIT_MAX", "100000")

# No test may call a real AI or address provider, whatever a developer's local
# .env holds. load_dotenv() never overrides a variable that is already set, so
# blanking them here wins. The secrets module then finds nothing in the
# environment and falls back to what tests store through the console flow.
for _name in ("OPENAI_API_KEY", "ANTHROPIC_API_KEY", "LOCATIONIQ_API_KEY", "GEOAPIFY_API_KEY",
              "GOOGLE_MAPS_API_KEY", "OPENAI_MODEL", "ANTHROPIC_MODEL", "FABLE_SECRETS_KEY"):
    os.environ[_name] = ""
