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
    ("Device", [
        ("device_anomaly", "Unrecognised device", 0.08),
        ("device_anomaly_large", "Unrecognised device, large transfer", 0.18),
        ("timezone_mismatch", "Device timezone differs", 0.08),
    ]),
    # A new place. The previous check compared city names, so a customer who
    # never left Lagos scored "new city Lagos" when the geocoder said Bariga.
    # The place check (agents/shield/places.py) measures distance from where
    # the customer has been, falling back to normalised names. Versions
    # approved before it keep the name check (LEGACY_FILL); new versions use
    # the place check instead.
    ("Location", [
        ("location_country", "Outside home country", 0.22),
        ("location_city_large", "New city by name, large transfer (retiring)", 0.0),
        ("location_city", "New city by name (retiring)", 0.0),
        ("location_place_large", "New place, large transfer", 0.12),
        ("location_place", "New place", 0.06),
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
    # A customer with no history of their own used to score a flat 0.47 on the
    # mobile app whatever the amount, just under the 0.48 flag line, so a first
    # transfer of NGN 900 million passed. These price the amount itself when
    # there is nothing personal to compare it with: the highest tier reached
    # applies, at full weight with no history at all and at half weight when
    # the bank's own customers give a population norm.
    ("First transfers (no history)", [
        ("first_amount_100k", "No history: NGN 100k or more", 0.10),
        ("first_amount_500k", "No history: NGN 500k or more", 0.20),
        ("first_amount_1m", "No history: NGN 1m or more", 0.28),
        ("first_amount_5m", "No history: NGN 5m or more", 0.36),
        ("first_amount_20m", "No history: NGN 20m or more", 0.45),
    ]),
    # Anomaly against the customer's own history (agents/shield/anomaly.py).
    # Each weight turns one model's 0..1 anomaly-ness into points. The previous
    # model (an Isolation Forest) scored even a typical transfer above its own
    # gate, so it is being retired: versions approved under it keep it
    # (LEGACY_FILL), and new versions use the nearest-neighbour model instead.
    ("Anomaly model", [
        ("ml_anomaly_previous", "Previous anomaly model (retiring)", 0.0),
        ("ml_anomaly", "Unusual amount and hour for this customer", 0.10),
    ]),
    # A transfer that takes most of the available balance (agents/shield/
    # analyzer.py, step 8b). The two share tiers are exclusive; the combination
    # weight adds on top when the money also goes to a new recipient or leaves
    # from a new device, which is the "move it to a safe account" script.
    ("Balance drain", [
        ("balance_drain_80", "Takes 80% or more of the balance", 0.10),
        ("balance_drain_all", "Takes the whole balance", 0.16),
        ("balance_drain_combo", "Drain to a new recipient or from a new device", 0.10),
    ]),
]
WEIGHT_DEFAULTS = {key: default for _, items in WEIGHT_GROUPS for key, _, default in items}

# Parameters added after versions were already approved. A stored version that
# predates one reads it as LEGACY_FILL (what it did before), so shipping the code changes
# no decision: the new values take effect only through a governed version.
LEGACY_FILL = {
    "first_amount_100k": 0.0, "first_amount_500k": 0.0, "first_amount_1m": 0.0,
    "first_amount_5m": 0.0, "first_amount_20m": 0.0,
    # A version from before the anomaly weights ran the previous model at 0.10.
    "ml_anomaly_previous": 0.10, "ml_anomaly": 0.0,
    # Balance drain did not exist: off in every version approved before it.
    "balance_drain_80": 0.0, "balance_drain_all": 0.0, "balance_drain_combo": 0.0,
    # The place check did not exist; those versions judged location by name.
    "location_place_large": 0.0, "location_place": 0.0,
}
# Which LEGACY_FILL parameters each prepared draft introduces. The release
# draft (no-history amounts and the anomaly model) and the balance-drain draft
# are separate, so each can be backtested and promoted on its own.
COLD_START_RELEASE_KEYS = ("first_amount_100k", "first_amount_500k", "first_amount_1m", "first_amount_5m",
                           "first_amount_20m", "ml_anomaly_previous", "ml_anomaly")
# The second prepared draft: balance drain, and location by place instead of
# by city name (which it sets to zero).
DRAIN_PLACE_KEYS = ("balance_drain_80", "balance_drain_all", "balance_drain_combo", "location_place_large",
                    "location_place")
DRAIN_PLACE_RETIRES = ("location_city_large", "location_city")
FIRST_AMOUNT_KEYS = ("first_amount_100k", "first_amount_500k", "first_amount_1m", "first_amount_5m",
                     "first_amount_20m")
FIRST_AMOUNT_TIERS = (
    (20_000_000, "first_amount_20m"), (5_000_000, "first_amount_5m"), (1_000_000, "first_amount_1m"),
    (500_000, "first_amount_500k"), (100_000, "first_amount_100k"),
)
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
    stored = params.get("weights")
    for key in base["weights"]:
        v = (stored or {}).get(key)
        if v is not None:
            base["weights"][key] = round(float(v), 4)
        elif stored is not None and key in LEGACY_FILL:
            # A version written before this parameter existed keeps behaving
            # exactly as it was approved.
            base["weights"][key] = LEGACY_FILL[key]
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
    w = p["weights"]
    tiers = [w[key] for _, key in reversed(FIRST_AMOUNT_TIERS)]
    if any(b < a - 1e-9 for a, b in zip(tiers, tiers[1:])):
        errors.append("No-history amount weights must not fall as the amount rises.")
    if w["balance_drain_all"] < w["balance_drain_80"] - 1e-9:
        errors.append("Taking the whole balance must weigh at least as much as taking 80% of it.")
    if base is not None:
        before = flat(base)
        # A parameter the base version never had is being introduced, not
        # moved: the step limit applies from the next version on.
        introduced = {f"weights.{k}" for k in LEGACY_FILL if k not in (base.get("weights") or {})}
        for path, v in flat(p).items():
            if path in introduced:
                continue
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


COLD_START_DRAFT_FLAG = "engine.cold_start_draft_seeded"


def seed_cold_start_draft() -> int | None:
    """Offer the no-history amount weights as a draft, once, on a deployment
    whose active version predates them.

    Nothing goes live: the draft has to be backtested, proposed, approved by a
    second owner (or through the cooling-off with one), shadowed and promoted
    on the Engine page like any other change. Returns the draft's number when
    one was created.
    """
    with _cursor() as cur:
        cur.execute("SELECT value FROM platform_settings WHERE key = ?", (COLD_START_DRAFT_FLAG,))
        if cur.fetchone():
            return None
        cur.execute("SELECT version, params FROM engine_versions WHERE status = 'active' "
                    "ORDER BY version DESC LIMIT 1")
        row = cur.fetchone()
        if not row:
            return None
        stored = json.loads(row["params"])
        if all(k in (stored.get("weights") or {}) for k in COLD_START_RELEASE_KEYS):
            cur.execute("INSERT OR IGNORE INTO platform_settings (key, value, updated_by) VALUES (?, 'not needed', "
                        "'system')", (COLD_START_DRAFT_FLAG,))
            return None
        params = normalise(stored)
        for key in COLD_START_RELEASE_KEYS:
            params["weights"][key] = WEIGHT_DEFAULTS[key]
        cur.execute("SELECT COALESCE(MAX(version), 0) + 1 AS v FROM engine_versions")
        version = cur.fetchone()["v"]
        cur.execute(
            """INSERT INTO engine_versions (version, status, params, params_hash, base_version, note, created_by)
               VALUES (?, 'draft', ?, ?, ?, ?, 'system')""",
            (version, canonical(params), params_hash(params), row["version"],
             "Prepared by the release: weights for customers with no history, so a large first transfer is "
             "flagged or blocked instead of passing at 0.47, and the current anomaly model in place of the "
             "previous one, which added points to typical transfers. Backtest, then propose. Past decisions "
             "did not record these terms, so the backtest under-reports their effect."),
        )
        cur.execute("INSERT OR IGNORE INTO platform_settings (key, value, updated_by) VALUES (?, ?, 'system')",
                    (COLD_START_DRAFT_FLAG, str(version)))
    return version


DRAIN_PLACE_DRAFT_FLAG = "engine.drain_place_draft_seeded"


def seed_drain_place_draft() -> int | None:
    """Offer balance drain and the place-based location check as a draft, once,
    on a deployment whose active version predates them.

    The draft is the active version with only these changes: the three drain
    weights and the two place weights at their recommended values, and the two
    name-based city weights at zero. Each is its own group on the Engine page,
    so the backtest and shadow show what each changes on its own. It is a new
    version, never a change to one already proposed, approved or in shadow.
    Returns the draft's number when one was created.
    """
    with _cursor() as cur:
        cur.execute("SELECT value FROM platform_settings WHERE key = ?", (DRAIN_PLACE_DRAFT_FLAG,))
        if cur.fetchone():
            return None
        cur.execute("SELECT version, params FROM engine_versions WHERE status = 'active' "
                    "ORDER BY version DESC LIMIT 1")
        row = cur.fetchone()
        if not row:
            return None
        stored = json.loads(row["params"])
        if all(k in (stored.get("weights") or {}) for k in DRAIN_PLACE_KEYS):
            cur.execute("INSERT OR IGNORE INTO platform_settings (key, value, updated_by) VALUES (?, 'not needed', "
                        "'system')", (DRAIN_PLACE_DRAFT_FLAG,))
            return None
        params = normalise(stored)
        for key in DRAIN_PLACE_KEYS + DRAIN_PLACE_RETIRES:
            params["weights"][key] = WEIGHT_DEFAULTS[key]
        cur.execute("SELECT COALESCE(MAX(version), 0) + 1 AS v FROM engine_versions")
        version = cur.fetchone()["v"]
        cur.execute(
            """INSERT INTO engine_versions (version, status, params, params_hash, base_version, note, created_by)
               VALUES (?, 'draft', ?, ?, ?, ?, 'system')""",
            (version, canonical(params), params_hash(params), row["version"],
             "Prepared by the release. Balance drain: a transfer taking 80% or more of the available balance, "
             "more for the whole balance, and more again to a new recipient or from a new device. Location: "
             "a new place measured by distance from where the customer has been (45 km), instead of a "
             "different city name, so Bariga and Lagos are the same place. Everything else is the active "
             "version. Backtest, then propose. Decisions before this release recorded neither the balance nor "
             "the place check, so the backtest cannot show these on them; the shadow run will."),
        )
        cur.execute("INSERT OR IGNORE INTO platform_settings (key, value, updated_by) VALUES (?, ?, 'system')",
                    (DRAIN_PLACE_DRAFT_FLAG, str(version)))
    return version


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
