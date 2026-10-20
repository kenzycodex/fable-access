"""scripts/recent_decisions.py reports recent decisions and never writes."""
import hashlib
import os
import subprocess
import sys
import tempfile

API = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, API)
os.environ.setdefault("FABLE_DB_PATH", os.path.join(tempfile.mkdtemp(), "recent.db"))
os.environ.setdefault("FABLE_SESSION_SECRET", "test-secret")


def test_the_report_lists_decisions_with_their_signals_and_writes_nothing():
    from core.db import cursor, get_conn

    get_conn()
    with cursor() as cur:
        cur.execute("INSERT INTO transactions (id, user_id, amount, channel, risk_score, action_taken, shield_signals, "
                    "institution_id) VALUES ('txn_recent', 'recent_user', 985500, 'internet', 0.374, 'PASS', "
                    "'[\"channel_risk: internet (+0.22)\"]', 'recentbank')")
    db = os.environ["FABLE_DB_PATH"]
    get_conn().execute("PRAGMA wal_checkpoint(TRUNCATE)")
    before = hashlib.sha256(open(db, "rb").read()).hexdigest()

    out = subprocess.run([sys.executable, "scripts/recent_decisions.py", "5"], cwd=API, env=os.environ,
                         capture_output=True, text=True, timeout=60)
    assert out.returncode == 0, out.stderr
    assert "NGN 985,500  internet  score 0.374  PASS" in out.stdout
    assert "channel_risk: internet (+0.22)" in out.stdout
    assert hashlib.sha256(open(db, "rb").read()).hexdigest() == before

