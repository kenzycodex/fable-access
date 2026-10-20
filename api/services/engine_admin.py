"""Changing Shield's weights and thresholds: model change management.

    draft  →  backtest  →  propose  →  approve  →  shadow  →  promote
                                                              ↘ roll back

The rules, in order of what they protect against (docs/ENGINE-GOVERNANCE.md):

* Bounds. Weights 0 to 0.5, with floors on the signals that must never be
  tuned away; flag at least 0.1 below block; no value moves more than 0.15 in
  one version; and no weight drifts more than 0.30 from the version live 30
  days ago without a written reason.
* Evidence first. A version can only be proposed with a backtest of its exact
  parameters that is less than 24 hours old.
* Frozen once proposed. Proposal records the parameters' SHA-256, approval
  records it again, and shadow and promote refuse any version whose stored
  parameters no longer match. Any edit means a new draft.
* Maker-checker, the same as Environment (services/approvals.py): a second
  owner approves, or with one owner a 12-hour cooling-off runs. When the
  backtest raised an impact warning, the approver must confirm they reviewed it.
* Shadow before live, by default: the approved version scores every new
  transfer alongside the live one, never acting on it.
* Every step is in the hash-chained audit and the main audit log, and owners
  are emailed at each stage.
"""
from __future__ import annotations

import json
import logging
from datetime import datetime, timedelta, timezone

from fastapi import HTTPException

from agents.shield import weights as W
from core import engine_config
from core.db import cursor, row_to_dict
from services import approvals, backtest
from services.secret_admin import alert_owners, log_event

logger = logging.getLogger("fable.engine")

BACKTEST_MAX_AGE_HOURS = 24
SHADOW_DAYS_DEFAULT = 3
SHADOW_DAYS_MAX = 30
PATH = "/operator/engine"
CLOSING = "If you did not expect this, reject it there."
PUBLIC = ("version", "status", "params", "params_hash", "approved_hash", "base_version", "rollback_of", "backtest_at",
          "note", "drift_note", "impact_ack", "created_by", "created_at", "proposed_by", "proposed_at",
          "single_approver", "apply_after", "expires_at", "approved_by", "approved_at", "decided_by", "decided_at",
          "shadow_started_at", "shadow_until", "shadow_by", "activated_at", "activated_by", "retired_at")


def _iso(dt: datetime) -> str:
    return approvals.iso(dt)


def _now() -> datetime:
    return approvals.now()


def _log(event: str, actor: str | None, version: int | None, **detail) -> None:
    log_event(f"engine.{event}", actor=actor, name="engine", version=version, detail=detail)


def _alert(subject: str, body: str, exclude: str | None = None) -> None:
    alert_owners(f"Engine: {subject}", body, exclude=exclude, path=PATH, closing=CLOSING)


# ── Reading ──────────────────────────────────────────────────────────────────

def _row(version: int) -> dict:
    with cursor() as cur:
        cur.execute("SELECT * FROM engine_versions WHERE version = ?", (version,))
        row = row_to_dict(cur.fetchone())
    if not row:
        raise HTTPException(status_code=404, detail="That engine version does not exist.")
    row["params"] = json.loads(row["params"])
    row["backtest"] = json.loads(row["backtest"]) if row.get("backtest") else None
    return row


def status(version: int) -> str:
    return _row(version)["status"]


def public(row: dict, with_backtest: bool = False) -> dict:
    out = {k: row.get(k) for k in PUBLIC}
    # Shown complete: a version stored before a parameter existed (the channel
    # weights) gets the code default for it. Hashes use the stored form.
    out["params"] = engine_config.normalise(row["params"])
    out["impact_ack"] = bool(row.get("impact_ack"))
    out["single_approver"] = bool(row.get("single_approver"))
    bt = row.get("backtest")
    if bt:
        out["backtest_summary"] = {"days": bt["days"], "run_at": bt["run_at"], "changed": bt["overall"]["changed"],
                                   "replayed": bt["rows"]["replayed"], "warnings": len(bt["warnings"]),
                                   "fresh": _fresh(row)}
        if with_backtest:
            out["backtest"] = bt
    return out


def _fresh(row: dict) -> bool:
    """A backtest of these exact parameters, less than 24 hours old."""
    if not row.get("backtest_at") or row.get("backtest_hash") != engine_config.params_hash(row["params"]):
        return False
    try:
        at = datetime.fromisoformat(row["backtest_at"]).replace(tzinfo=timezone.utc)
    except ValueError:
        return False
    return _now() - at <= timedelta(hours=BACKTEST_MAX_AGE_HOURS)


def _active_row() -> dict:
    engine_config.seed_if_empty()
    with cursor() as cur:
        cur.execute("SELECT version FROM engine_versions WHERE status = 'active' ORDER BY version DESC LIMIT 1")
        row = cur.fetchone()
    if not row:
        raise HTTPException(status_code=409, detail="No engine version is active.")
    return _row(row["version"])


def _previous_live(current: int) -> int | None:
    """The version that was live just before the current one, if any."""
    with cursor() as cur:
        cur.execute("SELECT version FROM engine_activations WHERE version != ? ORDER BY id DESC LIMIT 1", (current,))
        row = cur.fetchone()
    return row["version"] if row else None


def drift_reference(at: datetime | None = None) -> dict:
    """The version that was live DRIFT_DAYS ago, else version 1."""
    cutoff = _iso((at or _now()) - timedelta(days=engine_config.DRIFT_DAYS))
    with cursor() as cur:
        cur.execute(
            """SELECT version FROM engine_activations
               WHERE datetime(started_at) <= datetime(?) AND (ended_at IS NULL OR datetime(ended_at) > datetime(?))
               ORDER BY id DESC LIMIT 1""",
            (cutoff, cutoff),
        )
        row = cur.fetchone()
    return _row(row["version"] if row else 1)


def bounds() -> dict:
    return {
        "weight_max": engine_config.WEIGHT_MAX, "floors": engine_config.WEIGHT_FLOORS,
        "threshold_min": engine_config.THRESHOLD_MIN, "threshold_max": engine_config.THRESHOLD_MAX,
        "min_gap": engine_config.MIN_GAP, "max_step": engine_config.MAX_STEP, "drift_cap": engine_config.DRIFT_CAP,
        "drift_days": engine_config.DRIFT_DAYS, "windows": list(backtest.WINDOWS),
        "backtest_max_age_hours": BACKTEST_MAX_AGE_HOURS, "shadow_days_default": SHADOW_DAYS_DEFAULT,
        "shadow_days_max": SHADOW_DAYS_MAX,
    }


def catalogue() -> dict:
    return {
        "groups": [{"group": g, "weights": [{"key": k, "label": lbl, "default": d,
                                              "env": engine_config.weight_env(k)} for k, lbl, d in items]}
                   for g, items in engine_config.WEIGHT_GROUPS],
        "channels": ["default", *engine_config.CHANNELS],
    }


def overview() -> dict:
    sweep()
    active = _active_row()
    with cursor() as cur:
        cur.execute("SELECT version FROM engine_versions ORDER BY version DESC LIMIT 100")
        rows = [_row(r["version"]) for r in cur.fetchall()]
        cur.execute("SELECT * FROM engine_activations ORDER BY id DESC LIMIT 50")
        activations = [row_to_dict(r) for r in cur.fetchall()]
    shadow = next((r for r in rows if r["status"] == "shadow"), None)
    overrides = engine_config.env_overrides()
    effective = engine_config.active()
    return {
        "active": public(active),
        "effective": {"params": effective["params"], "hash": effective["hash"]},
        "shadow": {**public(shadow), "diff": shadow_diff(summary_only=True)} if shadow else None,
        "versions": [public(r) for r in rows],
        "activations": activations,
        "previous_live": _previous_live(active["version"]),
        "env_keys": [{"path": p, "env": engine_config.env_name(p), "value": v} for p, v in sorted(overrides.items())],
        "bounds": bounds(),
        "catalogue": catalogue(),
        "owners": len(approvals.owners()),
        "detection": detection_settings(),
        "cold_start": cold_start_status(active, rows),
    }


def cold_start_status(active: dict, rows: list[dict]) -> dict:
    """Whether the live version prices a first transfer when a customer has no
    history, and if not, which waiting version would.

    Shown as a banner on the Engine page: a deployment upgraded from before
    these weights keeps scoring a first NGN 900m at 0.47 until a version with
    them is approved and promoted.
    """
    keys = list(engine_config.FIRST_AMOUNT_KEYS)
    live = engine_config.normalise(active["params"])["weights"]
    live_on = any(live.get(k, 0) > 0 for k in keys)
    waiting = [
        {"version": r["version"], "status": r["status"]}
        for r in rows
        if r["status"] in ("draft", "proposed", "cooling", "approved", "shadow")
        and any(engine_config.normalise(r["params"])["weights"].get(k, 0) > 0 for k in keys)
    ]
    return {"live": live_on, "waiting": waiting}


def detection_settings() -> list[dict]:
    """The detection settings (Environment page), shown read-only on the Engine
    page: they shape decisions but cannot be backtested."""
    from core import secrets as vault

    values = W.detection()
    out = []
    for name in W.DETECTION_SETTINGS:
        spec = vault.MANAGED[name]
        try:
            source = vault.source(name)
        except Exception:  # noqa: BLE001
            source = "unset"
        out.append({"name": name, "label": spec.label, "value": values[name], "display": vault.display_number(values[name]),
                    "unit": spec.unit, "source": source if source != "unset" else "default"})
    return out


def version_detail(version: int) -> dict:
    row = _row(version)
    out = public(row, with_backtest=True)
    out["changes"] = engine_config.changes(_active_row()["params"], row["params"])
    out["errors"] = engine_config.validate(row["params"], _active_row()["params"]) if row["status"] == "draft" else []
    out["drift"] = engine_config.drift(row["params"], drift_reference()["params"])
    return out


# ── Drafts and backtests ─────────────────────────────────────────────────────

def _clean(params: dict) -> dict:
    if not isinstance(params, dict):
        raise HTTPException(status_code=422, detail="Send the parameters as weights and thresholds.")
    try:
        return engine_config.normalise(params)
    except (TypeError, ValueError) as exc:
        raise HTTPException(status_code=422, detail="Every weight and threshold must be a number.") from exc


def _check_bounds(params: dict) -> None:
    errors = engine_config.validate(params, _active_row()["params"])
    if errors:
        raise HTTPException(status_code=422, detail={"message": errors[0], "errors": errors})


def create_draft(op: dict, params: dict, note: str | None) -> dict:
    params = _clean(params)
    _check_bounds(params)
    base = _active_row()
    with cursor() as cur:
        cur.execute("SELECT COALESCE(MAX(version), 0) + 1 AS v FROM engine_versions")
        version = cur.fetchone()["v"]
        cur.execute(
            """INSERT INTO engine_versions (version, status, params, params_hash, base_version, note, created_by)
               VALUES (?, 'draft', ?, ?, ?, ?, ?)""",
            (version, engine_config.canonical(params), engine_config.params_hash(params), base["version"],
             (note or "").strip()[:500] or None, op["email"]),
        )
    _log("draft_created", op["email"], version, base_version=base["version"],
         changes=engine_config.changes(base["params"], params))
    return version_detail(version)


def update_draft(op: dict, version: int, params: dict, note: str | None) -> dict:
    row = _row(version)
    if row["status"] != "draft":
        raise HTTPException(status_code=409, detail="Only a draft can be edited. Proposed versions are frozen; "
                                                    "start a new draft instead.")
    params = _clean(params)
    _check_bounds(params)
    with cursor() as cur:
        cur.execute(
            """UPDATE engine_versions SET params = ?, params_hash = ?, note = COALESCE(?, note),
                 backtest = NULL, backtest_at = NULL, backtest_hash = NULL WHERE version = ? AND status = 'draft'""",
            (engine_config.canonical(params), engine_config.params_hash(params), (note or "").strip()[:500] or None,
             version),
        )
    _log("draft_updated", op["email"], version, changes=engine_config.changes(row["params"], params))
    return version_detail(version)


def run_backtest(op: dict, version: int, days: int) -> dict:
    row = _row(version)
    if row["status"] not in ("draft", "proposed", "cooling", "approved", "shadow"):
        raise HTTPException(status_code=409, detail="That version can no longer be backtested.")
    try:
        report = backtest.replay(row["params"], days)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    # Only a draft's evidence can be replaced. A proposed version keeps the
    # backtest it was approved on; a re-run is reported, not stored.
    if row["status"] == "draft":
        with cursor() as cur:
            cur.execute("UPDATE engine_versions SET backtest = ?, backtest_at = ?, backtest_hash = ? WHERE version = ?",
                        (json.dumps(report), report["run_at"], report["params_hash"], version))
    _log("backtest_run", op["email"], version, days=days, replayed=report["rows"]["replayed"],
         exact=report["rows"]["exact"], approximate=report["rows"]["approximate"], changed=report["overall"]["changed"],
         warnings=[w["kind"] for w in report["warnings"]], params_hash=report["params_hash"])
    return report


# ── Proposing and deciding ───────────────────────────────────────────────────

def propose(op: dict, version: int, note: str | None, drift_note: str | None, acknowledge: bool) -> dict:
    row = _row(version)
    if row["status"] != "draft":
        raise HTTPException(status_code=409, detail="Only a draft can be proposed.")
    _check_bounds(row["params"])
    if not _fresh(row):
        raise HTTPException(status_code=409, detail="Run a backtest of these exact parameters first. "
                                                    f"It must be less than {BACKTEST_MAX_AGE_HOURS} hours old.")
    drifted = engine_config.drift(row["params"], drift_reference()["params"])
    drift_note = (drift_note or "").strip()
    if drifted and len(drift_note) < 10:
        raise HTTPException(status_code=422, detail={
            "message": f"{drifted[0]}. Moving a weight more than {engine_config.DRIFT_CAP:g} in "
                       f"{engine_config.DRIFT_DAYS} days needs a written reason.", "errors": drifted})
    wait = approvals.plan()
    needs_ack = row["backtest"]["needs_ack"]
    # With one owner nobody else will read the impact report, so the proposer
    # confirms they reviewed it.
    if wait["single"] and needs_ack and not acknowledge:
        raise HTTPException(status_code=422, detail="The backtest raised impact warnings. Confirm you have "
                                                    "reviewed the impact.")
    digest = engine_config.params_hash(row["params"])
    status = "cooling" if wait["single"] else "proposed"
    with cursor() as cur:
        cur.execute(
            """UPDATE engine_versions SET status = ?, params_hash = ?, proposed_by = ?, proposed_at = datetime('now'),
                 single_approver = ?, apply_after = ?, expires_at = ?, note = COALESCE(?, note), drift_note = ?,
                 impact_ack = ? WHERE version = ? AND status = 'draft'""",
            (status, digest, op["email"], int(wait["single"]), wait["apply_after"], wait["expires_at"],
             (note or "").strip()[:500] or None, drift_note[:500] or None,
             int(bool(acknowledge and wait["single"])), version),
        )
    bt = row["backtest"]
    _log("proposed", op["email"], version, params_hash=digest, single_approver=wait["single"],
         backtest={"days": bt["days"], "changed": bt["overall"]["changed"], "replayed": bt["rows"]["replayed"],
                   "warnings": [w["kind"] for w in bt["warnings"]]}, drift=drifted, drift_note=drift_note or None)
    summary = f"{op['email']} proposed engine v{version}: {bt['overall']['changed']} of {bt['rows']['replayed']} " \
              f"past decisions would change, with {len(bt['warnings'])} impact warning(s)."
    if wait["single"]:
        _alert(f"v{version} held for {approvals.COOLING_HOURS} hours",
               summary + f" There is only one platform owner, so it is approved after a {approvals.COOLING_HOURS}-hour "
                         "cooling-off period unless cancelled. It does not go live until it is promoted.")
    else:
        _alert(f"v{version} needs your approval",
               summary + f" Another owner must approve it within {approvals.APPROVAL_HOURS} hours.", exclude=op["email"])
    return version_detail(version)


def approve(op: dict, version: int, acknowledge: bool) -> dict:
    row = _row(version)
    if row["status"] != "proposed":
        raise HTTPException(status_code=409, detail="That version is not waiting for approval.")
    approvals.ensure_checker(row["proposed_by"], op["email"])
    if engine_config.params_hash(row["params"]) != row["params_hash"]:
        raise HTTPException(status_code=409, detail="This version's parameters no longer match what was proposed.")
    if (row["backtest"] or {}).get("needs_ack") and not acknowledge:
        raise HTTPException(status_code=422, detail="The backtest raised impact warnings. Confirm you have "
                                                    "reviewed the impact before approving.")
    return _approved(row, op["email"], acknowledge)


def _approved(row: dict, approver: str | None, acknowledge: bool) -> dict:
    version = row["version"]
    digest = engine_config.params_hash(row["params"])
    with cursor() as cur:
        cur.execute(
            """UPDATE engine_versions SET status = 'approved', approved_hash = ?, approved_by = ?,
                 approved_at = datetime('now'), impact_ack = MAX(impact_ack, ?) WHERE version = ?""",
            (digest, approver or "cooling-off", int(bool(acknowledge)), version),
        )
    _log("approved", approver or "system (cooling-off ended)", version, params_hash=digest,
         proposed_by=row["proposed_by"], impact_acknowledged=bool(acknowledge or row.get("impact_ack")))
    if row.get("rollback_of"):
        # A rollback restores parameters that were already live, so it applies
        # as soon as it is approved.
        return _activate(_row(version), approver or "system (cooling-off ended)", "rollback")
    _alert(f"v{version} approved", f"Engine v{version}, proposed by {row['proposed_by']}, was approved"
           + (f" by {approver}." if approver else " after its cooling-off period.")
           + " It is not live yet: run it in shadow, then promote it.")
    return version_detail(version)


def reject(op: dict, version: int, reason: str | None) -> dict:
    row = _row(version)
    if row["status"] == "draft":
        status = "discarded"
    elif row["status"] in ("proposed", "cooling", "approved"):
        status = "cancelled" if row.get("proposed_by") == op["email"] else "rejected"
    else:
        raise HTTPException(status_code=409, detail="That version has already been decided.")
    with cursor() as cur:
        cur.execute("UPDATE engine_versions SET status = ?, decided_by = ?, decided_at = datetime('now') WHERE version = ?",
                    (status, op["email"], version))
    _log(status, op["email"], version, reason=reason)
    if status != "discarded":
        _alert(f"v{version} {status}", f"{op['email']} {status} engine v{version}." + (f" Reason: {reason}" if reason else ""))
    return version_detail(version)


# ── Shadow, promote, roll back ───────────────────────────────────────────────

def _frozen(row: dict) -> None:
    """Refuse a version whose stored parameters are not the ones approved."""
    if not row.get("approved_hash") or engine_config.params_hash(row["params"]) != row["approved_hash"]:
        _log("hash_mismatch", "system", row["version"], approved_hash=row.get("approved_hash"))
        raise HTTPException(status_code=409, detail="This version's parameters do not match what was approved. "
                                                    "It cannot run. Start a new draft.")


def start_shadow(op: dict, version: int, days: int) -> dict:
    row = _row(version)
    if row["status"] not in ("approved", "shadow"):
        raise HTTPException(status_code=409, detail="Only an approved version can run in shadow.")
    _frozen(row)
    if not 1 <= days <= SHADOW_DAYS_MAX:
        raise HTTPException(status_code=422, detail=f"Run shadow for 1 to {SHADOW_DAYS_MAX} days.")
    until = _iso(_now() + timedelta(days=days))
    with cursor() as cur:
        cur.execute("SELECT version FROM engine_versions WHERE status = 'shadow' AND version != ?", (version,))
        replaced = [r["version"] for r in cur.fetchall()]
        cur.execute("UPDATE engine_versions SET status = 'approved' WHERE status = 'shadow' AND version != ?", (version,))
        cur.execute("""UPDATE engine_versions SET status = 'shadow', shadow_started_at = datetime('now'), shadow_until = ?,
                         shadow_by = ? WHERE version = ?""", (until, op["email"], version))
    engine_config.bump_generation()
    for v in replaced:
        _log("shadow_ended", op["email"], v, reason=f"replaced by v{version}")
    _log("shadow_started", op["email"], version, days=days, until=until)
    _alert(f"v{version} running in shadow", f"{op['email']} started engine v{version} in shadow for {days} day(s). "
           "Live decisions are unchanged; disagreements are recorded on the Engine page.")
    return version_detail(version)


def stop_shadow(op: dict | None, version: int, reason: str = "stopped") -> dict:
    row = _row(version)
    if row["status"] != "shadow":
        raise HTTPException(status_code=409, detail="That version is not running in shadow.")
    diff = shadow_diff(summary_only=True)
    with cursor() as cur:
        cur.execute("UPDATE engine_versions SET status = 'approved' WHERE version = ? AND status = 'shadow'", (version,))
    engine_config.bump_generation()
    _log("shadow_ended", (op or {}).get("email") or "system", version, reason=reason, summary=diff)
    return version_detail(version)


def promote(op: dict, version: int) -> dict:
    row = _row(version)
    if row["status"] not in ("approved", "shadow"):
        raise HTTPException(status_code=409, detail="Only an approved version can be promoted.")
    _frozen(row)
    return _activate(row, op["email"], "promote")


def _activate(row: dict, by: str, kind: str) -> dict:
    version = row["version"]
    previous = _active_row()
    if previous["version"] == version:
        raise HTTPException(status_code=409, detail="That version is already live.")
    diff = shadow_diff(summary_only=True) if row["status"] == "shadow" else None
    with cursor() as cur:
        cur.execute("UPDATE engine_versions SET status = 'retired', retired_at = datetime('now') WHERE status = 'active'")
        cur.execute("UPDATE engine_activations SET ended_at = datetime('now') WHERE ended_at IS NULL")
        cur.execute("""UPDATE engine_versions SET status = 'active', activated_at = datetime('now'), activated_by = ?,
                         retired_at = NULL WHERE version = ?""", (by, version))
        cur.execute("INSERT INTO engine_activations (version, started_at, by, kind) VALUES (?, datetime('now'), ?, ?)",
                    (version, by, kind))
    engine_config.bump_generation()
    if diff is not None:
        _log("shadow_ended", by, version, reason="promoted", summary=diff)
    _log("promoted" if kind == "promote" else "rolled_back", by, version, kind=kind,
         previous_version=previous["version"], params_hash=engine_config.params_hash(row["params"]))
    _alert(f"v{version} is live", f"Engine v{version} replaced v{previous['version']} ({kind.replace('_', ' ')}, by {by}). "
           "Every new decision is scored by it within 30 seconds.")
    return version_detail(version)


def rollback(op: dict, target: int, reason: str) -> dict:
    """Restore an earlier version.

    To the version live just before the current one: one owner with a step-up,
    applied at once (an emergency must not wait for a second person), every
    owner alerted. To any other earlier version: a new version with the same
    parameters, through normal maker-checker, live as soon as it is approved.
    """
    row = _row(target)
    active = _active_row()
    if row["version"] == active["version"]:
        raise HTTPException(status_code=409, detail="That version is already live.")
    if row["status"] != "retired":
        raise HTTPException(status_code=409, detail="Only a version that was live before can be restored.")
    if target == _previous_live(active["version"]):
        _frozen(row)
        _log("emergency_rollback", op["email"], target, reason=reason, from_version=active["version"])
        return _activate(row, op["email"], "emergency_rollback")

    wait = approvals.plan()
    digest = engine_config.params_hash(row["params"])
    report = backtest.replay(row["params"], 30)
    with cursor() as cur:
        cur.execute("SELECT COALESCE(MAX(version), 0) + 1 AS v FROM engine_versions")
        version = cur.fetchone()["v"]
        cur.execute(
            """INSERT INTO engine_versions (version, status, params, params_hash, base_version, rollback_of, backtest,
                 backtest_at, backtest_hash, note, created_by, proposed_by, proposed_at, single_approver, apply_after,
                 expires_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), ?, ?, ?)""",
            (version, "cooling" if wait["single"] else "proposed", engine_config.canonical(row["params"]), digest,
             active["version"], target, json.dumps(report), report["run_at"], digest,
             f"Rollback to v{target}: {reason}"[:500], op["email"], op["email"], int(wait["single"]),
             wait["apply_after"], wait["expires_at"]),
        )
    _log("rollback_proposed", op["email"], version, rollback_of=target, reason=reason, params_hash=digest)
    _alert(f"rollback to v{target} proposed", f"{op['email']} proposed restoring engine v{target}'s parameters as "
           f"v{version}: {reason}", exclude=None if wait["single"] else op["email"])
    return version_detail(version)


# ── Shadow scoring (called off the hot path) ─────────────────────────────────

def record_shadow(transaction_id: str, result: dict, channel: str | None, institution_id: str | None) -> None:
    """Store the shadow version's verdict on a decision already committed."""
    parts = result.get("score_parts")
    shadow = engine_config.shadow()
    if not parts or not shadow:
        return
    score, action = W.replay(parts, channel, institution_id, shadow["params"])
    with cursor() as cur:
        cur.execute("UPDATE transactions SET shadow_version = ?, shadow_action = ?, shadow_score = ? WHERE id = ?",
                    (shadow["version"], action, score, transaction_id))


def shadow_diff(summary_only: bool = False, limit: int = 50) -> dict | None:
    with cursor() as cur:
        cur.execute("SELECT version, shadow_started_at FROM engine_versions WHERE status = 'shadow' LIMIT 1")
        row = cur.fetchone()
        if not row:
            return None
        version = row["version"]
        cur.execute(
            """SELECT action_taken, shadow_action, COUNT(*) AS n FROM transactions
               WHERE shadow_version = ? AND datetime(created_at) >= datetime(?) GROUP BY action_taken, shadow_action""",
            (version, row["shadow_started_at"]),
        )
        matrix = {b: {a: 0 for a in backtest.ACTIONS} for b in backtest.ACTIONS}
        for r in cur.fetchall():
            if r["action_taken"] in matrix and r["shadow_action"] in matrix:
                matrix[r["action_taken"]][r["shadow_action"]] = r["n"]
        total = sum(sum(v.values()) for v in matrix.values())
        agree = sum(matrix[a][a] for a in backtest.ACTIONS)
        out = {"version": version, "since": row["shadow_started_at"], "scored": total, "disagreements": total - agree,
               "matrix": matrix}
        if not summary_only:
            cur.execute(
                """SELECT id, institution_id, channel, amount, risk_score, action_taken, shadow_score, shadow_action,
                          created_at FROM transactions
                   WHERE shadow_version = ? AND datetime(created_at) >= datetime(?) AND shadow_action != action_taken
                   ORDER BY created_at DESC LIMIT ?""",
                (version, row["shadow_started_at"], limit),
            )
            out["recent"] = [row_to_dict(r) for r in cur.fetchall()]
            out["by_change"] = _shadow_attribution(cur, version, row["shadow_started_at"])
    return out


SHADOW_ATTRIBUTION_ROWS = 20_000


def _shadow_attribution(cur, version: int, since: str) -> list[dict]:
    """Which of the shadow version's changes moves which decisions, each on its
    own against the live values, from the decisions scored while it ran."""
    shadow = engine_config.shadow()
    if not shadow or shadow["version"] != version:
        return []
    cur.execute(
        f"""SELECT id, institution_id, channel, amount, score_parts FROM transactions
           WHERE shadow_version = ? AND datetime(created_at) >= datetime(?) AND score_parts IS NOT NULL
           ORDER BY created_at DESC LIMIT {SHADOW_ATTRIBUTION_ROWS}""",
        (version, since),
    )
    rows = []
    for r in cur.fetchall():
        try:
            rows.append({**row_to_dict(r), "parts": json.loads(r["score_parts"])})
        except (TypeError, ValueError):
            continue
    return backtest.attribute(rows, engine_config.active()["params"], shadow["params"])


# ── Housekeeping ─────────────────────────────────────────────────────────────

def sweep() -> None:
    """Expire stale proposals, end finished cooling-off and shadow periods."""
    now = _iso(_now())
    try:
        with cursor() as cur:
            cur.execute("SELECT version FROM engine_versions WHERE status = 'proposed' AND expires_at <= ?", (now,))
            expired = [r["version"] for r in cur.fetchall()]
            cur.execute("SELECT version FROM engine_versions WHERE status = 'cooling' AND apply_after <= ?", (now,))
            due = [r["version"] for r in cur.fetchall()]
            cur.execute("SELECT version FROM engine_versions WHERE status = 'shadow' AND shadow_until <= ?", (now,))
            finished = [r["version"] for r in cur.fetchall()]
    except Exception:  # noqa: BLE001 - no table yet
        return
    for v in expired:
        with cursor() as cur:
            cur.execute("UPDATE engine_versions SET status = 'expired', decided_at = datetime('now') WHERE version = ?", (v,))
        _log("expired", "system", v)
    for v in due:
        row = _row(v)
        if engine_config.params_hash(row["params"]) != row["params_hash"]:
            with cursor() as cur:
                cur.execute("UPDATE engine_versions SET status = 'rejected', decided_by = 'system' WHERE version = ?", (v,))
            _log("hash_mismatch", "system", v, stage="cooling-off")
            continue
        try:
            _approved(row, None, bool(row.get("impact_ack")))
        except HTTPException as exc:
            logger.warning("Engine v%s could not be applied after cooling-off: %s", v, exc.detail)
    for v in finished:
        try:
            stop_shadow(None, v, reason="shadow period ended")
        except HTTPException:
            pass
