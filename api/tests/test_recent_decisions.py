"""scripts/recent_decisions.py reports recent decisions and never writes."""
import hashlib
import os
import sqlite3
import subprocess
import sys
import tempfile

API = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def test_the_report_lists_decisions_with_their_signals_and_writes_nothing():
    # Its own database file, with the real schema, so the bytes can be compared.
    db = os.path.join(tempfile.mkdtemp(), "recent.db")
    env = {**os.environ, "FABLE_DB_PATH": db, "FABLE_SESSION_SECRET": "test-secret"}
    subprocess.run([sys.executable, "-c", "from core.db import get_conn; get_conn()"], cwd=API, env=env,
                   check=True, timeout=60)
    con = sqlite3.connect(db)
    con.execute("INSERT INTO transactions (id, user_id, amount, channel, risk_score, action_taken, shield_signals, "
                "institution_id) VALUES ('txn_recent', 'recent_user', 985500, 'internet', 0.374, 'PASS', "
                "'[\"channel_risk: internet (+0.22)\"]', 'recentbank')")
    con.commit()
    con.execute("PRAGMA wal_checkpoint(TRUNCATE)")
    con.close()
    before = hashlib.sha256(open(db, "rb").read()).hexdigest()

    out = subprocess.run([sys.executable, "scripts/recent_decisions.py", "5"], cwd=API, env=env,
                         capture_output=True, text=True, timeout=60)
    assert out.returncode == 0, out.stderr
    assert "NGN 985,500  internet  score 0.374  PASS" in out.stdout
    assert "channel_risk: internet (+0.22)" in out.stdout
    assert hashlib.sha256(open(db, "rb").read()).hexdigest() == before
