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
