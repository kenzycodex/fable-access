"""Nigerian scam pattern library (English + Pidgin). Loaded from JSON so the
list can be updated without touching code — mirrors the intelligence layer
described in the build brief and MVP implementation doc."""
import json
import os

_DIR = os.path.join(os.path.dirname(__file__), "..", "..", "intelligence", "scam_patterns")

_FILES = ["social_engineering.json", "investment_fraud.json", "aml_patterns.json"]


def _load_patterns() -> list[dict]:
    patterns = []
    for fname in _FILES:
        path = os.path.join(_DIR, fname)
        with open(path, "r", encoding="utf-8") as f:
            patterns.extend(json.load(f))
    return patterns


NIGERIAN_SCAM_PATTERNS = _load_patterns()


def match_scam_pattern(narration: str) -> dict | None:
    """Return the highest-weight scam pattern whose keyword appears in the narration."""
    if not narration:
        return None
    text = narration.lower()
    best = None
    for pattern in NIGERIAN_SCAM_PATTERNS:
        if any(kw in text for kw in pattern["keywords"]):
            if best is None or pattern["risk_weight"] > best["risk_weight"]:
                best = pattern
    return best
