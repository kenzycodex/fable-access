"""Backtest: what a draft engine version would have decided on real past transfers.

Shield's score is additive, and every decision since score parts were recorded
stores how its score was built (agents/shield/weights.py). So a past decision
is re-scored *exactly* under other weights and thresholds by re-adding its
parts, without re-running the engine or touching anything live. Older rows,
from before parts were recorded, are rebuilt from their signal text and counted
as approximate.

Two replays of the same rows are compared:

  before  the parameters in force now (the active version, environment over it)
  after   the draft (the environment over it as well, because that is what
          would score live if it were promoted)

so the report isolates the draft's own effect: an unchanged draft reports zero
changed decisions by construction. How faithfully "before" reproduces what was
actually decided is shown separately as replay fidelity.

Honesty rules (docs/ENGINE-GOVERNANCE.md):

* A transfer that was blocked and never labelled has no outcome: it never
  completed, so nobody knows whether it was fraud. Such rows are reported as
  "no outcome" and never counted as caught fraud.
* Labels are kept apart: fraud an analyst confirmed, transfers an analyst
  confirmed legitimate, and Ghost holds the customer cancelled (weaker, since
  customers cancel for other reasons too).
* Each bank's current risk policy is applied. There is no policy history, so
  the report says so.
* Every metric carries the number of labelled rows behind it, with a warning
  below MIN_SAMPLE.

Read-only. Nothing here writes to the database.
"""
from __future__ import annotations

import json
import re
from collections import Counter, defaultdict
from datetime import datetime, timedelta, timezone

from agents.shield import weights as W
from core import engine_config
from core.db import cursor
from eval.harness import metrics

WINDOWS = (30, 60, 90)
MIN_SAMPLE = 30
MAX_ROWS = 250_000
ACTIONS = ("PASS", "FLAG", "BLOCK")
SPIKE_RELATIVE = 0.25
SPIKE_ABSOLUTE = 0.02
SPIKE_FLOOR = 5
POLICY_NOTE = "Each bank's current risk policy was used. There is no policy history to replay against."


# ── Older rows: parts rebuilt from signal text ───────────────────────────────

_PLUS = re.compile(r"\(\+([0-9.]+)\)")
_MINUS = re.compile(r"\(-([0-9.]+)\)")


def _boost(signal: str) -> float | None:
    m = _PLUS.search(signal)
    return float(m.group(1)) if m else None


def _closest(boost: float, keys: tuple[str, ...], ref: dict) -> str:
    return min(keys, key=lambda k: abs(ref[k] - boost))


def _weighted(key: str, boost: float | None, ref: dict, rounded: bool = False) -> list:
    """A term on `key` whose value under the reference weights equals `boost`."""
    if boost is None or abs(ref[key] - boost) < 1e-9:
        return W.term({key: 1}, rounded=rounded)
    if ref[key] <= 0:
        return W.term(const=boost)
    return W.term({key: boost / ref[key]}, rounded=rounded)


def legacy_parts(signals: list[str], ref: dict) -> dict | None:
    """Score parts rebuilt from signal strings, against reference weights.

    `ref` are the weights believed in force when the row was scored (version
    1, which was seeded from them). Returns None when a signal cannot be read,
    in which case the row is skipped rather than guessed.
    """
    from agents.shield.analyzer import _amount_boost_from_sigma
    from agents.shield.nip_codes import get_nip_risk_signal

    parts: dict = {"terms": [], "tenure": 0.0, "nip34": False}
    add = parts["terms"].append
    for s in signals or []:
        name, _, text = s.partition(":")
        boost = _boost(s)
        if name == "system_error":
            return None
        if name in ("cold_start", "channel_risk", "scam_pattern", "ml_anomaly"):
            if boost is None:
                return None
            add(W.term(const=boost))
        elif name == "amount_anomaly":
            mult = re.search(r"(\d+)x", text)
            if not mult or boost is None:
                return None
            key = W.amount_key(W.amount_tier(int(mult.group(1))))
            sigma = re.search(r"([0-9.]+) standard deviations", text)
            by_sigma = _amount_boost_from_sigma(float(sigma.group(1))) if sigma else 2 * boost - ref[key]
            add(W.term({key: 1}, const=by_sigma, divisor=2, rounded=True))
        elif name == "new_recipient":
            add(_weighted("new_recipient", boost, ref, rounded=True))
        elif name == "time_anomaly":
            add(W.term({"time_anomaly": 1}))
        elif name.startswith("nip_"):
            code = name[4:]
            add(W.term(const=get_nip_risk_signal(code)["shield_score_boost"]))
            parts["nip34"] = parts["nip34"] or code == "34"
        elif name == "device_anomaly":
            if boost is None:
                return None
            if "seen before" in text:
                add(_weighted("device_anomaly", boost, ref, rounded=True))
            else:
                add(_weighted(_closest(boost, ("device_anomaly_large", "device_anomaly"), ref), boost, ref))
        elif name == "location_anomaly":
            if boost is None:
                return None
            key = "location_country" if "usually" in text else _closest(boost, ("location_city_large", "location_city"), ref)
            add(_weighted(key, boost, ref))
        elif name in ("session_freshness", "timezone_mismatch"):
            add(_weighted(name, boost, ref))
        elif name == "behavioral_anomaly":
            keys = {}
            if "pasted" in text:
                keys["behavioral_paste"] = 1
            if "submitted in" in text:
                keys["behavioral_fast"] = 1
            if not keys:
                return None
            add(W.term(keys, rounded=True))
        elif name == "failed_verification":
            if boost is None:
                return None
            key = (_closest(boost, ("failed_verification_high", "failed_verification_large"), ref)
                   if "recently" in text else "failed_verification")
            add(_weighted(key, boost, ref))
        elif name == "velocity":
            if boost is None:
                return None
            add(_weighted(_closest(boost, ("velocity_high", "velocity"), ref), boost, ref))
        elif name == "tenure":
            m = _MINUS.search(s)
            parts["tenure"] = float(m.group(1)) if m else 0.0
        elif boost is not None:
            add(W.term(const=boost))  # a signal this reader does not know, kept as a fixed part
        else:
            return None
    return parts


# ── The replay ───────────────────────────────────────────────────────────────

def _rows(since: str, institution: str | None):
    where, params = "datetime(created_at) >= datetime(?) AND action_taken IN ('PASS','FLAG','BLOCK') " \
                    "AND COALESCE(is_seed, 0) = 0", [since]
    if institution:
        where += " AND institution_id = ?"
        params.append(institution)
    with cursor() as cur:
        cur.execute(
            f"""SELECT id, institution_id, channel, action_taken, shield_signals, score_parts,
                       review_outcome, status
                FROM transactions WHERE {where} ORDER BY created_at DESC LIMIT {MAX_ROWS}""",
            params,
        )
        return [dict(r) for r in cur.fetchall()]


def _label(row: dict) -> str | None:
    if row.get("review_outcome") == "fraud":
        return "fraud"
    if row.get("review_outcome") == "legitimate":
        return "legitimate"
    if row.get("status") == "cancelled":
        return "ghost_cancelled"
    return None


def _rate(n: int, total: int) -> float:
    return round(n / total, 4) if total else 0.0


def _group_stats(items: list[tuple[str, str]]) -> dict:
    n = len(items)
    before, after = Counter(b for b, _ in items), Counter(a for _, a in items)
    return {
        "n": n,
        "changed": sum(1 for b, a in items if b != a),
        "block_before": before["BLOCK"], "block_after": after["BLOCK"],
        "flag_before": before["FLAG"], "flag_after": after["FLAG"],
        "block_rate_before": _rate(before["BLOCK"], n), "block_rate_after": _rate(after["BLOCK"], n),
    }


def _spike(g: dict, floor: int = SPIKE_FLOOR) -> bool:
    """A block-rate move worth a second look: more than 25% relative, or more
    than 2 percentage points, and never on fewer than `floor` decisions."""
    delta = g["block_after"] - g["block_before"]
    if abs(delta) < floor:
        return False
    if g["block_before"] == 0:
        return True
    relative = abs(delta) / g["block_before"]
    absolute = abs(g["block_rate_after"] - g["block_rate_before"])
    return relative > SPIKE_RELATIVE or absolute > SPIKE_ABSOLUTE


def _outcomes(labelled: dict[str, list[tuple[str, str]]]) -> dict:
    def caught(items, side):
        return sum(1 for pair in items if pair[side] != "PASS")

    out = {}
    for label, items in labelled.items():
        n = len(items)
        entry = {"n": n, "low_sample": n < MIN_SAMPLE,
                 "before": dict(Counter(b for b, _ in items)), "after": dict(Counter(a for _, a in items))}
        if label in ("fraud", "ghost_cancelled"):
            entry.update(caught_before=caught(items, 0), caught_after=caught(items, 1),
                         missed_before=n - caught(items, 0), missed_after=n - caught(items, 1),
                         newly_caught=sum(1 for b, a in items if b == "PASS" and a != "PASS"),
                         newly_missed=sum(1 for b, a in items if b != "PASS" and a == "PASS"))
        else:
            entry.update(blocked_before=sum(1 for b, _ in items if b == "BLOCK"),
                         blocked_after=sum(1 for _, a in items if a == "BLOCK"),
                         friction_before=caught(items, 0), friction_after=caught(items, 1),
                         newly_blocked=sum(1 for b, a in items if b != "BLOCK" and a == "BLOCK"))
        out[label] = entry

    fraud, legit = labelled.get("fraud", []), labelled.get("legitimate", [])
    for side, key in ((0, "metrics_before"), (1, "metrics_after")):
        tp = sum(1 for p in fraud if p[side] != "PASS")
        fp = sum(1 for p in legit if p[side] != "PASS")
        m = metrics(tp, fp, len(legit) - fp, len(fraud) - tp)
        out[key] = {**m, "n": len(fraud) + len(legit), "low_sample": len(fraud) + len(legit) < MIN_SAMPLE}
    return out


def replay(params: dict, days: int = 30, institution: str | None = None, now: datetime | None = None) -> dict:
    """The impact report for `params` against the last `days` of decisions."""
    if days not in WINDOWS:
        raise ValueError(f"Choose a window of {', '.join(str(w) for w in WINDOWS)} days.")
    now = now or datetime.now(timezone.utc)
    since = (now - timedelta(days=days)).strftime("%Y-%m-%d %H:%M:%S")

    overrides = engine_config.env_overrides()
    current = engine_config.active()["params"]
    draft = engine_config.apply_env(params, overrides)
    reference = _reference_weights()

    matrix = {b: {a: 0 for a in ACTIONS} for b in ACTIONS}
    exact = approximate = skipped = fidelity = 0
    by_channel: dict[str, list] = defaultdict(list)
    by_bank: dict[str, list] = defaultdict(list)
    labelled: dict[str, list] = {"fraud": [], "legitimate": [], "ghost_cancelled": []}
    no_outcome = 0
    pairs = []

    for row in _rows(since, institution):
        parts = None
        if row.get("score_parts"):
            try:
                parts = json.loads(row["score_parts"])
                is_exact = True
            except ValueError:
                parts = None
        if parts is None:
            try:
                signals = json.loads(row.get("shield_signals") or "[]")
            except ValueError:
                signals = None
            parts = legacy_parts(signals, reference) if isinstance(signals, list) else None
            is_exact = False
        if parts is None:
            skipped += 1
            continue
        try:
            _, before = W.replay(parts, row["channel"], row["institution_id"], current)
            _, after = W.replay(parts, row["channel"], row["institution_id"], draft)
        except (KeyError, TypeError, ValueError):
            skipped += 1
            continue
        exact += is_exact
        approximate += not is_exact
        fidelity += before == row["action_taken"]
        matrix[before][after] += 1
        pair = (before, after)
        pairs.append(pair)
        by_channel[row["channel"] or "unknown"].append(pair)
        by_bank[row["institution_id"] or "unknown"].append(pair)
        label = _label(row)
        if label is None and row["action_taken"] == "BLOCK":
            no_outcome += 1  # never completed and never labelled: not evidence either way
        elif label:
            labelled[label].append(pair)

    overall = _group_stats(pairs)
    channels = [{"channel": k, **_group_stats(v)} for k, v in sorted(by_channel.items())]
    banks = [{"institution_id": k, **_group_stats(v)} for k, v in sorted(by_bank.items())]
    outcomes = _outcomes(labelled)
    outcomes["no_outcome_blocked"] = no_outcome

    warnings = []
    if _spike(overall, floor=1):
        warnings.append({"kind": "block_rate", "message": (
            f"The overall block rate moves from {overall['block_rate_before']:.1%} to "
            f"{overall['block_rate_after']:.1%}.")})
    for g in channels:
        if _spike(g):
            warnings.append({"kind": "channel_spike", "scope": g["channel"], "message": (
                f"{g['channel']}: block rate {g['block_rate_before']:.1%} to {g['block_rate_after']:.1%}.")})
    for g in banks:
        if _spike(g):
            warnings.append({"kind": "bank_spike", "scope": g["institution_id"], "message": (
                f"{g['institution_id']}: block rate {g['block_rate_before']:.1%} to {g['block_rate_after']:.1%}.")})
    fraud = outcomes.get("fraud", {})
    if fraud.get("missed_after", 0) > fraud.get("missed_before", 0):
        warnings.append({"kind": "fraud_missed", "message": (
            f"Confirmed-fraud misses rise from {fraud['missed_before']} to {fraud['missed_after']}.")})

    replayed = exact + approximate
    return {
        "days": days,
        "since": since,
        "institution": institution,
        "run_at": now.strftime("%Y-%m-%d %H:%M:%S"),
        "params_hash": engine_config.params_hash(params),
        "rows": {"replayed": replayed, "exact": exact, "approximate": approximate, "skipped": skipped,
                 "fidelity": fidelity, "truncated": replayed + skipped >= MAX_ROWS},
        "matrix": matrix,
        "overall": overall,
        "by_channel": channels,
        "by_bank": banks,
        "outcomes": outcomes,
        "warnings": warnings,
        "needs_ack": bool(warnings),
        "env_keys": [{"path": p, "env": engine_config.env_name(p)} for p in sorted(overrides)],
        "policy_note": POLICY_NOTE,
        "min_sample": MIN_SAMPLE,
    }


def _reference_weights() -> dict:
    """The weights older rows were scored with, as far as anyone knows: version
    1, which was seeded from the values in force before versions existed."""
    with cursor() as cur:
        cur.execute("SELECT params FROM engine_versions WHERE version = 1")
        row = cur.fetchone()
    params = json.loads(row["params"]) if row else engine_config.apply_env(engine_config.code_defaults())
    return engine_config.normalise(params)["weights"]
