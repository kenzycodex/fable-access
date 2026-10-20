"""Recent Shield decisions, read-only: the engine version in force, each bank's
thresholds, a per-day summary for 14 days, and the last N decisions with the
signals that scored them and how much history the customer had.

Opens the database read-only (SQLite mode=ro), so it cannot change anything.

    docker compose exec -T api python scripts/recent_decisions.py 20
"""
import json
import os
import sqlite3
import sys

db = os.environ.get("FABLE_DB_PATH", "/data/fable.db")
con = sqlite3.connect(f"file:{db}?mode=ro", uri=True)
con.row_factory = sqlite3.Row


def q(sql, *args):
    return con.execute(sql, args).fetchall()


print("== Engine version in force, and any in shadow ==")
for r in q("SELECT version, status, created_at FROM engine_versions WHERE status IN ('active','shadow') ORDER BY version"):
    print(f"  v{r['version']}  {r['status']}  created {r['created_at']}")

print("\n== Thresholds each bank has set (blank = default flag 0.5, block 0.8) ==")
for r in q("SELECT institution_id, flag_threshold, block_threshold FROM institution_settings"):
    print(f"  {r['institution_id']}: flag {r['flag_threshold']}  block {r['block_threshold']}")

print("\n== Per day, last 14 days ==")
print("  day         count  avg score  pass  flag  block")
for r in q("""SELECT date(created_at) d, COUNT(*) n, ROUND(AVG(risk_score),3) avg,
                     SUM(action_taken='PASS') p, SUM(action_taken='FLAG') f, SUM(action_taken='BLOCK') b
              FROM transactions WHERE datetime(created_at) >= datetime('now','-14 days')
              GROUP BY d ORDER BY d"""):
    print(f"  {r['d']}  {r['n']:>5}  {r['avg']:>9}  {r['p']:>4}  {r['f']:>4}  {r['b']:>5}")

n = int(sys.argv[1]) if len(sys.argv) > 1 else 15
print(f"\n== Last {n} decisions ==")
for r in q("""SELECT t.created_at, t.institution_id, t.user_id, t.amount, t.channel, t.risk_score, t.action_taken,
                     t.engine_version, t.shield_signals,
                     (SELECT COUNT(*) FROM transactions h WHERE h.user_id = t.user_id
                        AND datetime(h.created_at) < datetime(t.created_at)) AS earlier
              FROM transactions t ORDER BY datetime(t.created_at) DESC LIMIT ?""", n):
    print(f"\n  {r['created_at']}  {r['institution_id']}  {r['user_id']}  "
          f"NGN {r['amount']:,.0f}  {r['channel']}  score {r['risk_score']}  {r['action_taken']}  "
          f"engine v{r['engine_version']}  ({r['earlier']} earlier transfers by this customer)")
    for s in json.loads(r["shield_signals"] or "[]"):
        print(f"      {s}")
