"""Background jobs: expiring holds, delivering webhooks, purging old data.

Fable had no scheduler. Expired holds were swept only when the API started,
webhook retries lived in a thread pool that a restart wiped, and nothing ever
purged anything. This runs those jobs on a timer, in a daemon thread started
with the app.

Each job holds a lease in the database while it runs, so if more than one
worker process is ever started, only one of them runs a given job at a time,
and a job whose worker died is picked up by another once its lease lapses.
Every job is idempotent, so running one twice is harmless; the lease just
avoids doing the work twice.

Jobs can also be run by hand (`run_due(force=True)`), which is how the tests
and the operator console drive them.
"""
from __future__ import annotations

import logging
import os
import socket
import threading
import time
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Callable

from core.db import cursor

logger = logging.getLogger("fable.scheduler")

TICK_SECONDS = 10
LEASE_SECONDS = 120
_HOLDER = f"{socket.gethostname()}:{os.getpid()}"


@dataclass
class Job:
    name: str
    every_seconds: int
    run: Callable[[], object]


_jobs: dict[str, Job] = {}
_thread: threading.Thread | None = None
_stop = threading.Event()
_started_at = time.time()


def register(name: str, every_seconds: int, run: Callable[[], object]) -> None:
    _jobs[name] = Job(name, every_seconds, run)


def enabled() -> bool:
    return os.getenv("FABLE_SCHEDULER", "on").strip().lower() not in ("0", "off", "false", "no")


def _now() -> float:
    return time.time()


def _iso(ts: float) -> str:
    return datetime.fromtimestamp(ts, tz=timezone.utc).isoformat()


def _claim(job: Job, force: bool) -> bool:
    """Take the job's lease if it is due and nobody else holds it."""
    now = _now()
    with cursor() as cur:
        cur.execute("INSERT OR IGNORE INTO job_runs (name, lease_until, last_started) VALUES (?, 0, 0)", (job.name,))
        due = "" if force else " AND last_started <= ?"
        params: list = [_HOLDER, now + LEASE_SECONDS, now, job.name, now]
        if not force:
            params.append(now - job.every_seconds)
        cur.execute(
            f"UPDATE job_runs SET holder = ?, lease_until = ?, last_started = ? "
            f"WHERE name = ? AND lease_until < ?{due}",
            params,
        )
        return cur.rowcount > 0


def _finish(job: Job, ok: bool, detail: str | None) -> None:
    with cursor() as cur:
        cur.execute(
            "UPDATE job_runs SET lease_until = 0, last_finished = ?, last_ok = ?, last_detail = ?, "
            "runs = COALESCE(runs, 0) + 1, failures = COALESCE(failures, 0) + ? WHERE name = ?",
            (_now(), 1 if ok else 0, (detail or "")[:300], 0 if ok else 1, job.name),
        )


def run_job(job: Job, force: bool = False) -> object | None:
    if not _claim(job, force):
        return None
    try:
        result = job.run()
    except Exception as exc:  # noqa: BLE001 - one job failing must not stop the others
        logger.warning("Job %s failed: %s", job.name, type(exc).__name__)
        _finish(job, False, type(exc).__name__)
        return None
    _finish(job, True, None if result is None else str(result))
    return result


def run_due(force: bool = False) -> dict:
    """Run every job that is due (or all of them, with force). {name: result}."""
    return {name: run_job(job, force) for name, job in list(_jobs.items())}


def _loop() -> None:
    while not _stop.wait(TICK_SECONDS):
        try:
            run_due()
        except Exception as exc:  # noqa: BLE001 - the loop itself must survive anything
            logger.warning("Scheduler tick failed: %s", type(exc).__name__)


def start() -> None:
    global _thread, _started_at
    if not enabled() or (_thread and _thread.is_alive()):
        return
    _started_at = time.time()
    _stop.clear()
    _thread = threading.Thread(target=_loop, name="fable-scheduler", daemon=True)
    _thread.start()


def stop() -> None:
    _stop.set()


def status() -> dict:
    """For /health: whether the loop runs and when each job last finished."""
    jobs = {}
    try:
        with cursor() as cur:
            cur.execute("SELECT name, last_finished, last_ok, failures, runs FROM job_runs")
            for row in cur.fetchall():
                jobs[row["name"]] = {
                    "last_finished": _iso(row["last_finished"]) if row["last_finished"] else None,
                    "last_ok": bool(row["last_ok"]) if row["last_ok"] is not None else None,
                    "runs": row["runs"] or 0,
                    "failures": row["failures"] or 0,
                }
    except Exception:  # noqa: BLE001 - no table yet
        pass
    stale = []
    now = _now()
    for name, job in _jobs.items():
        info = jobs.get(name)
        finished = None
        if info and info["last_finished"]:
            finished = datetime.fromisoformat(info["last_finished"]).timestamp()
        grace = max(job.every_seconds * 5, 300)
        if enabled() and now - _started_at > grace and (finished is None or now - finished > grace):
            stale.append(name)
    return {
        "enabled": enabled(),
        "running": bool(_thread and _thread.is_alive()),
        "jobs": jobs,
        "stale": stale,
    }
