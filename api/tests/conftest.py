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
# The background scheduler would race the tests for the same rows. Tests run
# its jobs directly (services.scheduler.run_due).
os.environ["FABLE_SCHEDULER"] = "off"

# No test may call a real AI or address provider, whatever a developer's local
# .env holds. load_dotenv() never overrides a variable that is already set, so
# blanking them here wins. The secrets module then finds nothing in the
# environment and falls back to what tests store through the console flow.
for _name in ("OPENAI_API_KEY", "ANTHROPIC_API_KEY", "LOCATIONIQ_API_KEY", "GEOAPIFY_API_KEY",
              "GOOGLE_MAPS_API_KEY", "OPENAI_MODEL", "ANTHROPIC_MODEL", "FABLE_SECRETS_KEY"):
    os.environ[_name] = ""

# No test may send real email either. A module run on its own used to pick up
# the developer's SMTP login from .env, and security alerts to the tests' fake
# owners went out through a real mailbox. Blank, always, before config loads.
for _name in ("SMTP_USERNAME", "SMTP_PASSWORD"):
    os.environ[_name] = ""


def pytest_collection_modifyitems(config, items):
    """FABLE_TEST_SHUFFLE=<seed> runs the tests in a random order, to prove none
    depends on another having run first: the modules in a random order, and the
    tests in a random order inside each module. Modules are kept together, as
    pytest-randomly does, because each module sets up its fixtures once. The
    seed is printed so a failing order can be replayed. Off by default; CI runs
    the normal order."""
    seed = os.environ.get("FABLE_TEST_SHUFFLE")
    if not seed:
        return
    import random

    rng = random.Random(seed)
    modules: dict[str, list] = {}
    for item in items:
        modules.setdefault(item.module.__name__, []).append(item)
    order = list(modules)
    rng.shuffle(order)
    shuffled = []
    for name in order:
        group = modules[name]
        rng.shuffle(group)
        shuffled.extend(group)
    items[:] = shuffled
    print(f"Tests shuffled with FABLE_TEST_SHUFFLE={seed}")
