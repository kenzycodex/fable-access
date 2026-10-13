"""Turn coordinates into a street address with Google's Geocoding API.

The device supplies the coordinates (GPS through the browser); this only names
the place. OpenStreetMap, which the browser used before, knows Lagos campuses
and districts but few house numbers, so a customer at home was described by the
nearest landmark. Google's address data is what ride and delivery apps show.

The key stays on the server. Calling Google from the browser would publish it.

Results are kept in memory for a short time, keyed to about a metre, so a
customer reopening the transfer screen does not cost a second lookup. Google's
terms allow temporary caching for performance; nothing is written to disk.
"""
from __future__ import annotations

import json
import logging
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
from collections import OrderedDict

import config

logger = logging.getLogger("fable.geocoding")

ENDPOINT = "https://maps.googleapis.com/maps/api/geocode/json"
TIMEOUT_SECONDS = 4
CACHE_TTL_SECONDS = 60 * 60
CACHE_MAX = 5000

# Most specific first. A street_address or premise carries a house number; the
# rest are progressively coarser places to fall back to.
_PREFERRED_TYPES = ("street_address", "premise", "subpremise", "route", "plus_code")

_cache: OrderedDict[tuple[float, float], tuple[float, dict]] = OrderedDict()
_lock = threading.Lock()
_denied_logged = False


def available() -> bool:
    return bool(config.GOOGLE_MAPS_API_KEY)


def _component(components: list[dict], *types: str) -> str | None:
    for wanted in types:
        for c in components:
            if wanted in c.get("types", []):
                return c.get("long_name")
    return None


def _short(components: list[dict], kind: str) -> str | None:
    for c in components:
        if kind in c.get("types", []):
            return c.get("short_name")
    return None


def _pick(results: list[dict]) -> dict | None:
    for kind in _PREFERRED_TYPES:
        for r in results:
            if kind in r.get("types", []):
                return r
    return results[0] if results else None


def parse(body: dict) -> dict | None:
    """Shape a Geocoding API response into the fields the client uses."""
    results = body.get("results") or []
    best = _pick(results)
    if not best:
        return None
    comps = best.get("address_components") or []

    house_number = _component(comps, "street_number")
    street = _component(comps, "route")
    area = _component(comps, "neighborhood", "sublocality_level_1", "sublocality")
    region = _component(comps, "administrative_area_level_1")
    # The metro, never a district, because scoring compares cities: "Lagos",
    # not "Shomolu". Some Nigerian results omit locality and name only the
    # state, so the state stands in with its " State" suffix removed.
    city = _component(comps, "locality", "postal_town")
    if not city and region:
        city = region.removesuffix(" State").strip() or None

    street_line = " ".join(p for p in (house_number, street) if p) or None
    plus = (body.get("plus_code") or {}).get("compound_code") or (best.get("plus_code") or {}).get("compound_code")

    return {
        "formatted_address": best.get("formatted_address"),
        "house_number": house_number,
        "street": street,
        "street_line": street_line,
        "area": area,
        "city": city,
        "region": region,
        "country": _component(comps, "country"),
        "country_code": _short(comps, "country"),
        "postal_code": _component(comps, "postal_code"),
        # Precise to a few metres; useful where a street has no numbers.
        "plus_code": plus,
        "result_type": next((t for t in _PREFERRED_TYPES if t in best.get("types", [])), None),
        "source": "google",
    }


def _fetch(lat: float, lon: float) -> dict:
    query = urllib.parse.urlencode({
        "latlng": f"{lat},{lon}",
        "key": config.GOOGLE_MAPS_API_KEY,
        "language": "en",
    })
    req = urllib.request.Request(f"{ENDPOINT}?{query}", headers={"Accept": "application/json"})
    with urllib.request.urlopen(req, timeout=TIMEOUT_SECONDS) as resp:  # noqa: S310 - fixed https host
        return json.loads(resp.read().decode("utf-8"))


def reverse(lat: float, lon: float) -> dict | None:
    """The address at these coordinates, or None when Google cannot say.

    Never raises: a failed lookup means the client falls back to OpenStreetMap,
    and a transfer is never held up by a map service.
    """
    global _denied_logged
    if not available():
        return None

    # Five decimal places is about 1.1 m, finer than any phone fix.
    key = (round(lat, 5), round(lon, 5))
    now = time.monotonic()
    with _lock:
        hit = _cache.get(key)
        if hit and now - hit[0] < CACHE_TTL_SECONDS:
            _cache.move_to_end(key)
            return hit[1]

    try:
        body = _fetch(lat, lon)
    except (urllib.error.URLError, TimeoutError, ValueError, OSError) as exc:
        logger.warning("Google reverse geocoding failed: %s", exc)
        return None

    status = body.get("status")
    if status == "ZERO_RESULTS":
        return None
    if status != "OK":
        # REQUEST_DENIED is a key problem (wrong key, API not enabled, billing
        # off, or an IP restriction that does not include this server). Said
        # once, loudly, rather than on every transfer.
        if status == "REQUEST_DENIED" and not _denied_logged:
            _denied_logged = True
            logger.error(
                "Google Geocoding refused the key: %s. Check that the Geocoding "
                "API is enabled, billing is on, and any IP restriction includes "
                "this server.", body.get("error_message", "no detail"),
            )
        else:
            logger.warning("Google reverse geocoding returned %s: %s", status, body.get("error_message", ""))
        return None

    place = parse(body)
    if place:
        with _lock:
            _cache[key] = (now, place)
            _cache.move_to_end(key)
            while len(_cache) > CACHE_MAX:
                _cache.popitem(last=False)
    return place
