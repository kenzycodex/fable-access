"""Shield's tunable parameters: signal weights and decision thresholds, versioned.

The engine reads its weights and thresholds from here, not from import-time
constants. One rule of precedence, the same as core/secrets.py:

  1. The server environment wins. A FABLE_W_* or threshold variable still set
     in api/.env is used as is, and the operator console shows it as managed
     there, read-only.
  2. Otherwise, the active version approved in the operator console.
  3. Otherwise (no version stored yet), the built-in defaults.

On first use, version 1 is seeded from what is in force today (the environment
over the code defaults), so shipping this changes no decision.

A version is changed only through the governed flow in services/engine_admin.py:
draft, backtest, propose, approve, shadow, promote, roll back. Once proposed, a
version's parameters are frozen and their SHA-256 recorded; shadow and promote
refuse a version whose parameters no longer match it.

What is deliberately NOT here: values that change *whether* a signal fires
(velocity window and counts, tenure, recipient memory). Past decisions cannot
be replayed exactly under those, so they stay in the environment.
"""
from __future__ import annotations

import copy
import hashlib
import json
import os
import threading
import time

CACHE_SECONDS = 30

# ── The catalogue ────────────────────────────────────────────────────────────

# (key, label, code default). The env variable is FABLE_W_<KEY upper>.
WEIGHT_GROUPS: list[tuple[str, list[tuple[str, str, float]]]] = [
    ("Amount", [
        ("amount_50x", "50x or more above normal", 0.40),
        ("amount_25x", "25x above normal", 0.34),
        ("amount_10x", "10x above normal", 0.28),
        ("amount_5x", "5x above normal", 0.20),
        ("amount_3x", "3x to 5x above normal", 0.15),
    ]),
    ("Recipient and time", [
        ("new_recipient", "First transfer to this account", 0.20),
        ("time_anomaly", "Outside usual hours", 0.12),
    ]),
    ("Device and location", [
        ("device_anomaly", "Unrecognised device", 0.08),
        ("device_anomaly_large", "Unrecognised device, large transfer", 0.18),
        ("location_country", "Outside home country", 0.22),
        ("location_city_large", "New city, large transfer", 0.12),
        ("location_city", "New city", 0.06),
        ("timezone_mismatch", "Device timezone differs", 0.08),
    ]),
    ("Behaviour", [
        ("session_freshness", "Transfer seconds after login", 0.12),
        ("behavioral_paste", "Account number pasted", 0.06),
        ("behavioral_fast", "Submitted with no hesitation", 0.09),
    ]),
    ("Verification", [
        ("failed_verification", "A failed identity check", 0.08),
        ("failed_verification_large", "3+ failed checks", 0.15),
        ("failed_verification_high", "3+ failed checks, large transfer", 0.25),
    ]),
    ("Velocity", [
        ("velocity", "Burst of transfers", 0.10),
        ("velocity_high", "Heavy burst of transfers", 0.20),
    ]),
    # Points for the rail itself (agents/shield/channel_risk.py explains the
    # NIBSS grounding). A channel at or below CHANNEL_GATE adds nothing, which
    # is how an in-person branch transfer carries no channel signal at all.
    # The environment names are FABLE_CHANNEL_<NAME>, kept from before.
    ("Channel risk", [
        ("channel_internet", "Internet banking", 0.22),
        ("channel_pos", "POS", 0.18),
        ("channel_mobile_app", "Mobile app", 0.12),
        ("channel_ussd", "USSD", 0.12),
        ("channel_atm", "ATM", 0.12),
        ("channel_qr", "QR", 0.10),
        ("channel_branch", "Branch", 0.02),
        ("channel_unknown", "Any other channel", 0.15),
    ]),
]
WEIGHT_DEFAULTS = {key: default for _, items in WEIGHT_GROUPS for key, _, default in items}
WEIGHT_LABELS = {key: label for _, items in WEIGHT_GROUPS for key, label, _ in items}

# Per-channel (block, flag). The default applies to an unknown channel.
CHANNEL_DEFAULTS = {
    "internet": (0.75, 0.45),
    "pos": (0.78, 0.48),
    "atm": (0.78, 0.48),
    "mobile_app": (0.78, 0.48),
    "qr": (0.80, 0.50),
    "ussd": (0.82, 0.52),
    "branch": (0.85, 0.55),
}
DEFAULT_THRESHOLD = (0.80, 0.50)
CHANNELS = list(CHANNEL_DEFAULTS)

# ── Bounds ───────────────────────────────────────────────────────────────────

WEIGHT_MAX = 0.5
# Signals that must never be tuned away. NIP boosts are not tunable at all.
WEIGHT_FLOORS = {
    "failed_verification": 0.05,
    "failed_verification_large": 0.10,
    "failed_verification_high": 0.15,
    "device_anomaly": 0.04,
    "device_anomaly_large": 0.08,
    "new_recipient": 0.10,
}
THRESHOLD_MIN, THRESHOLD_MAX = 0.20, 0.95
MIN_GAP = 0.10       # flag must sit at least this far below block
MAX_STEP = 0.15      # the most one version may move a value from the version it was drafted from
DRIFT_CAP = 0.30     # the most a weight may drift from the version active 30 days ago without a note
DRIFT_DAYS = 30


def weight_env(key: str) -> str:
    if key.startswith("channel_"):
        return f"FABLE_CHANNEL_{key[len('channel_'):].upper()}"
    return f"FABLE_W_{key.upper()}"


def threshold_env(scope: str, kind: str) -> str:
    if scope == "default":
        return f"FABLE_{kind.upper()}_THRESHOLD"
    return f"FABLE_THRESHOLD_{scope.upper()}_{kind.upper()}"


def code_defaults() -> dict:
    return {
        "weights": dict(WEIGHT_DEFAULTS),
        "thresholds": {
            "default": {"block": DEFAULT_THRESHOLD[0], "flag": DEFAULT_THRESHOLD[1]},
            **{ch: {"block": b, "flag": f} for ch, (b, f) in CHANNEL_DEFAULTS.items()},
        },
    }


def _env_float(name: str) -> float | None:
    raw = (os.getenv(name) or "").strip()
    if not raw:
        return None
    try:
        return float(raw)
    except ValueError:
        return None  # an unreadable value never takes effect


def env_overrides() -> dict[str, float]:
    """Every engine value set in the server environment, as {path: value}.

    Paths are "weights.<key>" and "thresholds.<scope>.<block|flag>".
    """
    out: dict[str, float] = {}
    for key in WEIGHT_DEFAULTS:
        v = _env_float(weight_env(key))
        if v is not None:
            out[f"weights.{key}"] = v
    for scope in ("default", *CHANNELS):
        for kind in ("block", "flag"):
            v = _env_float(threshold_env(scope, kind))
            if v is not None:
                out[f"thresholds.{scope}.{kind}"] = v
    return out


def env_name(path: str) -> str:
    parts = path.split(".")
    return weight_env(parts[1]) if parts[0] == "weights" else threshold_env(parts[1], parts[2])


def apply_env(params: dict, overrides: dict[str, float] | None = None) -> dict:
    """A version's parameters with the environment laid over them."""
    out = normalise(params)
    for path, value in (env_overrides() if overrides is None else overrides).items():
        parts = path.split(".")
        if parts[0] == "weights":
            out["weights"][parts[1]] = value
        else:
            out["thresholds"].setdefault(parts[1], {})[parts[2]] = value
    return out


def normalise(params: dict | None) -> dict:
    """A complete parameter set: anything missing filled from the code defaults,
    anything unknown dropped. Values are floats rounded to 4 places."""
    base = code_defaults()
    params = params or {}
    for key in base["weights"]:
        v = (params.get("weights") or {}).get(key)
        if v is not None:
            base["weights"][key] = round(float(v), 4)
    for scope, pair in base["thresholds"].items():
        given = (params.get("thresholds") or {}).get(scope) or {}
        for kind in ("block", "flag"):
            if given.get(kind) is not None:
                pair[kind] = round(float(given[kind]), 4)
    return base


def canonical(params: dict) -> str:
    return json.dumps(normalise(params), sort_keys=True, separators=(",", ":"))


def params_hash(params: dict) -> str:
    """SHA-256 of a parameter set exactly as given.

    Not normalised first, on purpose: a version stored before a parameter
    existed (the channel weights joined later) must keep the hash it was
    approved with. Everything this module stores or applies is already
    complete (normalise and apply_env return full sets), so for those the
    result is the same as hashing the normalised form.
    """
    return hashlib.sha256(json.dumps(params, sort_keys=True, separators=(",", ":")).encode()).hexdigest()


def decision_hash(params_digest: str, detection: dict) -> str:
    """What a decision records: the engine parameters' hash together with the
    detection settings (Environment page) it was scored under."""
    body = json.dumps({"engine": params_digest, "detection": detection}, sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(body.encode()).hexdigest()


def flat(params: dict) -> dict[str, float]:
    p = normalise(params)
    out = {f"weights.{k}": v for k, v in p["weights"].items()}
    for scope, pair in p["thresholds"].items():
        for kind, v in pair.items():
            out[f"thresholds.{scope}.{kind}"] = v
    return out


def label(path: str) -> str:
    parts = path.split(".")
    if parts[0] == "weights":
        return WEIGHT_LABELS.get(parts[1], parts[1])
    scope = "Default" if parts[1] == "default" else parts[1].replace("_", " ")
    return f"{scope} {parts[2]} threshold"


# ── Validation ───────────────────────────────────────────────────────────────

def validate(params: dict, base: dict | None = None) -> list[str]:
    """Every reason these parameters may not be proposed. Empty means valid.

    `base` is the version the draft was made from: no value may move further
    than MAX_STEP from it in one version.
    """
    errors = []
    p = normalise(params)
    for key, v in p["weights"].items():
        floor = WEIGHT_FLOORS.get(key, 0.0)
        if not floor - 1e-9 <= v <= WEIGHT_MAX + 1e-9:
            errors.append(f"{WEIGHT_LABELS[key]} must be between {floor:g} and {WEIGHT_MAX:g}.")
    for scope, pair in p["thresholds"].items():
        name = "Default" if scope == "default" else scope.replace("_", " ")
        for kind in ("block", "flag"):
            if not THRESHOLD_MIN - 1e-9 <= pair[kind] <= THRESHOLD_MAX + 1e-9:
                errors.append(f"{name} {kind} threshold must be between {THRESHOLD_MIN:g} and {THRESHOLD_MAX:g}.")
        if pair["block"] - pair["flag"] < MIN_GAP - 1e-9:
            errors.append(f"{name}: the flag threshold must sit at least {MIN_GAP:g} below the block threshold.")
    if base is not None:
        before = flat(base)
        for path, v in flat(p).items():
            if abs(v - before[path]) > MAX_STEP + 1e-9:
                errors.append(f"{label(path)} moves by {abs(v - before[path]):.2f}; one version may move a value "
                              f"by at most {MAX_STEP:g}.")
    return errors


def drift(params: dict, reference: dict) -> list[str]:
    """Weights that drift more than DRIFT_CAP from the reference version."""
    now, ref = normalise(params)["weights"], normalise(reference)["weights"]
    return [f"{WEIGHT_LABELS[k]} drifts {abs(now[k] - ref[k]):.2f} from 30 days ago"
            for k in now if abs(now[k] - ref[k]) > DRIFT_CAP + 1e-9]


def changes(before: dict, after: dict) -> list[dict]:
    a, b = flat(before), flat(after)
    return [{"path": p, "label": label(p), "from": a[p], "to": b[p]} for p in b if abs(a[p] - b[p]) > 1e-9]


# ── Versions ─────────────────────────────────────────────────────────────────

_lock = threading.Lock()
_cache: dict[str, object] = {"checked": 0.0, "generation": None, "active": None, "shadow": None, "loaded": False}


def _cursor():
    from core.db import cursor

    return cursor()


def seed_if_empty() -> None:
    """Version 1 = what is in force today, so nothing changes when this ships."""
    with _cursor() as cur:
        cur.execute("SELECT 1 FROM engine_versions LIMIT 1")
        if cur.fetchone():
            return
        params = apply_env(code_defaults())
        digest = params_hash(params)
        cur.execute(
            """INSERT OR IGNORE INTO engine_versions
                 (version, status, params, params_hash, approved_hash, note, created_by, approved_by,
                  approved_at, activated_at, activated_by)
               VALUES (1, 'active', ?, ?, ?, 'Seeded from the values in force when the Engine page shipped.',
                       'system', 'system', datetime('now'), datetime('now'), 'system')""",
            (canonical(params), digest, digest),
        )
        if cur.rowcount:
            cur.execute("INSERT INTO engine_activations (version, started_at, by, kind) "
                        "VALUES (1, datetime('now'), 'system', 'seed')")


def _generation() -> str | None:
    with _cursor() as cur:
        cur.execute("SELECT value FROM platform_settings WHERE key = 'engine.generation'")
        row = cur.fetchone()
    return row["value"] if row else None


def bump_generation() -> None:
    """Tell every process the active or shadow version changed (seen within 30 s)."""
    with _cursor() as cur:
        cur.execute(
            """INSERT INTO platform_settings (key, value, updated_by) VALUES ('engine.generation', ?, 'system')
               ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')""",
            (str(time.time_ns()),),
        )
    with _lock:
        _cache["checked"] = 0.0
        _cache["loaded"] = False


def _load(status: str) -> dict | None:
    with _cursor() as cur:
        cur.execute("SELECT version, params, approved_hash, shadow_started_at, shadow_until FROM engine_versions "
                    "WHERE status = ? ORDER BY version DESC LIMIT 1", (status,))
        row = cur.fetchone()
    if not row:
        return None
    return {"version": row["version"], "params": json.loads(row["params"]), "approved_hash": row["approved_hash"],
            "shadow_started_at": row["shadow_started_at"], "shadow_until": row["shadow_until"]}


def _refresh() -> None:
    now = time.monotonic()
    if _cache["loaded"] and now - _cache["checked"] < CACHE_SECONDS:
        return
    try:
        gen = _generation()
        if _cache["loaded"] and gen == _cache["generation"]:
            with _lock:
                _cache["checked"] = now
            return
        seed_if_empty()
        active, shadow = _load("active"), _load("shadow")
    except Exception:  # noqa: BLE001 - a database blip keeps what was cached
        with _lock:
            _cache["checked"] = now
        return
    with _lock:
        _cache.update(checked=now, generation=gen, active=active, shadow=shadow, loaded=True)


def _effective(entry: dict | None) -> dict | None:
    if entry is None:
        return None
    overrides = env_overrides()
    params = apply_env(entry["params"], overrides)
    return {**entry, "stored": entry["params"], "params": params, "hash": params_hash(params),
            "env_keys": sorted(overrides)}


def active() -> dict:
    """The version scoring live decisions, with the environment laid over it.

    {"version", "params", "hash", "stored", "env_keys"}. With no database (or
    before any version exists) it is the code defaults and version None.
    """
    _refresh()
    entry = _cache["active"] or {"version": None, "params": code_defaults(), "approved_hash": None}
    return _effective(copy.deepcopy(entry))


def shadow() -> dict | None:
    """The version running in shadow, if any, with the environment laid over it."""
    _refresh()
    return _effective(copy.deepcopy(_cache["shadow"])) if _cache["shadow"] else None


def current_params() -> dict:
    return active()["params"]
