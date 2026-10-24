"""Nigerian scam pattern library (English + Pidgin). Loaded from JSON so the
list can be updated without touching code — mirrors the intelligence layer
described in the build brief and MVP implementation doc."""
import json
import os
import re
from functools import lru_cache

_DIR = os.path.join(os.path.dirname(__file__), "..", "..", "intelligence", "scam_patterns")

_FILES = ["social_engineering.json", "investment_fraud.json", "aml_patterns.json"]


def _load_patterns() -> tuple[list[dict], list[str]]:
    """Load every pattern file, tolerating a broken one.

    This runs at import. Previously a missing or malformed JSON file raised
    here, which failed the import of analyzer.py, which failed the import of
    routers/shield.py — and main.py's resilient router loader caught that,
    logged a warning, and carried on. The API booted, /health returned 200,
    and POST /v1/shield/analyze returned 404: the entire product gone, with a
    single log line as evidence. A pattern library is enrichment, not a
    dependency of scoring, so a bad file now degrades that one file's patterns
    and is reported through /health instead.
    """
    patterns: list[dict] = []
    errors: list[str] = []
    for fname in _FILES:
        path = os.path.join(_DIR, fname)
        try:
            with open(path, "r", encoding="utf-8") as f:
                loaded = json.load(f)
            if not isinstance(loaded, list):
                raise ValueError("expected a JSON array of patterns")
            patterns.extend(loaded)
        except (OSError, ValueError) as exc:
            errors.append(f"{fname}: {type(exc).__name__}: {exc}")
    return patterns, errors


NIGERIAN_SCAM_PATTERNS, PATTERN_LOAD_ERRORS = _load_patterns()


def library_health() -> dict:
    """Pattern-library status, surfaced by /health so a broken file is visible
    rather than silently reducing detection."""
    return {
        "patterns_loaded": len(NIGERIAN_SCAM_PATTERNS),
        "files_expected": len(_FILES),
        "errors": PATTERN_LOAD_ERRORS,
        "healthy": not PATTERN_LOAD_ERRORS,
    }


@lru_cache(maxsize=512)
def _keyword_re(keyword: str) -> "re.Pattern[str]":
    """Word-boundary matcher for one keyword.

    Bare substring matching produced domain-wrong hits that are common in real
    Nigerian narrations: "mum" fired inside *premium*, *maximum* and *minimum*,
    and "dad" inside *dada*. Multi-word keywords keep internal spacing but are
    still anchored at both ends, so "changed account" does not match
    "unchanged accounts".
    """
    return re.compile(r"\b" + r"\s+".join(re.escape(w) for w in keyword.split()) + r"\b")


def _matches(keyword: str, text: str) -> bool:
    return bool(_keyword_re(keyword.lower()).search(text))


def match_scam_pattern(narration: str) -> dict | None:
    """Return the highest-weight scam pattern whose keyword appears in the narration."""
    if not narration:
        return None
    text = narration.lower()
    best = None
    for pattern in NIGERIAN_SCAM_PATTERNS:
        if any(_matches(kw, text) for kw in pattern["keywords"]):
            if best is None or pattern["risk_weight"] > best["risk_weight"]:
                best = pattern
    return best
