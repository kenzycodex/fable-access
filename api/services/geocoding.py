"""Turn a device's coordinates into a street, a landmark and a Plus Code.

The device supplies the coordinates (GPS through the browser); this only names
the place, the way a ride app does: nearest named street, the area, a landmark
close by, and a Plus Code that pins the spot to about 14 m.

House numbers are rare in Lagos map data, so one is shown only when the data
has one within a few metres. Nothing is invented.

Sources, best first, each optional except OpenStreetMap:
  * Google Geocoding        GOOGLE_MAPS_API_KEY  (needs Google billing)
  * LocationIQ              LOCATIONIQ_API_KEY   (free, no card, link-back)
  * Geoapify                GEOAPIFY_API_KEY     (free, no card, link-back)
  * OpenStreetMap Nominatim no key, 1 request a second
The landmark is the named building or amenity the geocoder matched, when that
is not the street itself. Keys stay on the server.

Overpass was tried for landmarks and tagged house numbers and dropped: the
public servers took 8 to 27 seconds or timed out, far over a transfer screen's
budget.

Results are kept in memory for an hour, keyed to about 11 m. Nothing is
written to disk, and only the city ever reaches scoring.
"""
from __future__ import annotations

import json
import logging
import math
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
from collections import OrderedDict

from core import config

logger = logging.getLogger("fable.geocoding")

TIMEOUT_SECONDS = 4
CACHE_TTL_SECONDS = 60 * 60
CACHE_MAX = 5000
USER_AGENT = "Fable/1.0 (fraud prevention; +https://fablehq.vercel.app)"

_cache: OrderedDict[tuple[float, float], tuple[float, dict]] = OrderedDict()
_lock = threading.Lock()

# Nominatim's policy is at most one request a second per application.
_nominatim_lock = threading.Lock()
_nominatim_last = 0.0

# A provider that refused its key (billing off, key revoked) is skipped for a
# while instead of being asked, and refusing, on every transfer.
_disabled_until: dict[str, float] = {}
DISABLE_SECONDS = 15 * 60


def available() -> bool:
    # OpenStreetMap needs no key, so an address can always be attempted.
    return True


# ── Plus Codes (Open Location Code), computed locally ────────────────────────

_OLC_ALPHABET = "23456789CFGHJMPQRVWX"


def plus_code(lat: float, lon: float) -> str:
    """The 10-character Plus Code for a point: a cell about 14 m square.

    Open Location Code is an open standard, so no service is needed. Integer
    arithmetic at the finest resolution (1/8000 of a degree) avoids the
    floating-point drift that a digit-by-digit division would build up.
    """
    lat = min(max(lat, -90.0), 90.0)
    lon = ((lon + 180.0) % 360.0) - 180.0
    lat_i = math.floor(round((lat + 90.0) * 8000, 6))
    lon_i = math.floor(round((lon + 180.0) * 8000, 6))
    lat_i = min(lat_i, 180 * 8000 - 1)  # the north pole belongs to the last cell

    lat_digits, lon_digits = [], []
    for _ in range(5):
        lat_digits.append(_OLC_ALPHABET[lat_i % 20])
        lon_digits.append(_OLC_ALPHABET[lon_i % 20])
        lat_i //= 20
        lon_i //= 20
    pairs = "".join(a + b for a, b in zip(reversed(lat_digits), reversed(lon_digits)))
    return f"{pairs[:8]}+{pairs[8:]}"


# ── HTTP ─────────────────────────────────────────────────────────────────────

def _http_json(url: str, data: bytes | None = None) -> dict:
    headers = {"Accept": "application/json", "User-Agent": USER_AGENT}
    if data is not None:
        headers["Content-Type"] = "application/x-www-form-urlencoded"
    req = urllib.request.Request(url, data=data, headers=headers)
    with urllib.request.urlopen(req, timeout=TIMEOUT_SECONDS) as resp:  # noqa: S310 - fixed https hosts
        return json.loads(resp.read().decode("utf-8"))


def _skip(provider: str) -> bool:
    return _disabled_until.get(provider, 0) > time.monotonic()


def _disable(provider: str, reason: str) -> None:
    if not _skip(provider):
        logger.error("%s refused the request (%s). Skipping it for %d minutes.", provider, reason, DISABLE_SECONDS // 60)
    _disabled_until[provider] = time.monotonic() + DISABLE_SECONDS


# ── Shaping ──────────────────────────────────────────────────────────────────

# A Nigerian metro spans many local government areas, and map data names the
# LGA ("Ikeja", "Bariga") as the city. Customers cross them daily, so for these
# the state is the city, and the LGA becomes the district shown on screen.
_STATE_METROS = {
    "lagos": "Lagos",
    "lagos state": "Lagos",
    "federal capital territory": "Abuja",
    "fct": "Abuja",
}


def _metro(city: str | None, state: str | None) -> tuple[str | None, str | None]:
    """(metro, district). The metro, never a district, because scoring compares
    cities. Without a city, the state stands in with " State" removed."""
    metro = _STATE_METROS.get((state or "").strip().lower())
    if metro:
        return metro, (city if city and city != metro else None)
    if city:
        return city, None
    if state:
        return state.removesuffix(" State").strip() or None, None
    return None, None


def _shape(house_number, street, area, city_state, region, country, country_code, source, landmark=None) -> dict:
    city, district = city_state
    return {
        "house_number": house_number or None,
        "street": street or None,
        "area": area or None,
        "district": district or None,
        "city": city or None,
        "landmark": landmark or None,
        "region": region or None,
        "country": country or None,
        "country_code": (country_code or "").upper() or None,
        "source": source,
    }


def _parse_osm_address(body: dict, source: str) -> dict:
    """Nominatim and LocationIQ share OpenStreetMap's address breakdown. The
    matched object's own name ("Faculty of Engineering") is the landmark.

    LocationIQ's normalised form differs in two places: the name sits inside
    the address, and a Lagos LGA comes as `county` with no city.
    """
    a = body.get("address") or {}
    city = a.get("city") or a.get("town") or a.get("village") or a.get("county")
    landmark = body.get("name") or a.get("name") or a.get("amenity") or a.get("building") or a.get("shop") or a.get("office")
    return _shape(
        a.get("house_number"),
        a.get("road") or a.get("pedestrian") or a.get("footway"),
        a.get("neighbourhood") or a.get("suburb") or a.get("quarter") or a.get("city_district"),
        _metro(city, a.get("state")),
        a.get("state"),
        a.get("country"),
        a.get("country_code"),
        source,
        landmark,
    )


# ── Providers ────────────────────────────────────────────────────────────────

_GOOGLE_TYPES = ("street_address", "premise", "subpremise", "route", "plus_code")


def _component(components: list[dict], *types: str, short: bool = False) -> str | None:
    for wanted in types:
        for c in components:
            if wanted in c.get("types", []):
                return c.get("short_name" if short else "long_name")
    return None


def parse_google(body: dict) -> dict | None:
    results = body.get("results") or []
    best = next((r for t in _GOOGLE_TYPES for r in results if t in r.get("types", [])), results[0] if results else None)
    if not best:
        return None
    comps = best.get("address_components") or []
    region = _component(comps, "administrative_area_level_1")
    return _shape(
        _component(comps, "street_number"),
        _component(comps, "route"),
        _component(comps, "neighborhood", "sublocality_level_1", "sublocality"),
        _metro(_component(comps, "locality", "postal_town"), region),
        region,
        _component(comps, "country"),
        _component(comps, "country", short=True),
        "google",
    )


def _google(lat: float, lon: float) -> dict | None:
    key = config.GOOGLE_MAPS_API_KEY
    if not key or _skip("google"):
        return None
    q = urllib.parse.urlencode({"latlng": f"{lat},{lon}", "key": key, "language": "en"})
    body = _http_json(f"https://maps.googleapis.com/maps/api/geocode/json?{q}")
    status = body.get("status")
    if status == "OK":
        return parse_google(body)
    if status in ("REQUEST_DENIED", "OVER_DAILY_LIMIT"):
        _disable("google", body.get("error_message") or status)
    return None


def _locationiq(lat: float, lon: float) -> dict | None:
    key = config.LOCATIONIQ_API_KEY
    if not key or _skip("locationiq"):
        return None
    q = urllib.parse.urlencode({
        "key": key, "lat": lat, "lon": lon, "format": "json",
        "addressdetails": 1, "normalizeaddress": 1, "accept-language": "en",
    })
    try:
        body = _http_json(f"https://us1.locationiq.com/v1/reverse?{q}")
    except urllib.error.HTTPError as exc:
        if exc.code in (401, 403):
            _disable("locationiq", f"HTTP {exc.code}")
        raise
    return _parse_osm_address(body, "locationiq")


def _geoapify(lat: float, lon: float) -> dict | None:
    key = config.GEOAPIFY_API_KEY
    if not key or _skip("geoapify"):
        return None
    q = urllib.parse.urlencode({"lat": lat, "lon": lon, "apiKey": key, "format": "json", "lang": "en"})
    try:
        body = _http_json(f"https://api.geoapify.com/v1/geocode/reverse?{q}")
    except urllib.error.HTTPError as exc:
        if exc.code in (401, 403):
            _disable("geoapify", f"HTTP {exc.code}")
        raise
    r = (body.get("results") or [None])[0]
    if not r:
        return None
    return _shape(
        r.get("housenumber"),
        r.get("street"),
        r.get("suburb") or r.get("district") or r.get("quarter"),
        _metro(r.get("city"), r.get("state")),
        r.get("state"),
        r.get("country"),
        r.get("country_code"),
        "geoapify",
    )


def _nominatim(lat: float, lon: float) -> dict | None:
    global _nominatim_last
    with _nominatim_lock:
        wait = 1.0 - (time.monotonic() - _nominatim_last)
        if wait > 0:
            time.sleep(wait)
        _nominatim_last = time.monotonic()
    q = urllib.parse.urlencode({
        "format": "jsonv2", "lat": lat, "lon": lon, "zoom": 18,
        "addressdetails": 1, "accept-language": "en",
    })
    body = _http_json(f"https://nominatim.openstreetmap.org/reverse?{q}")
    return _parse_osm_address(body, "openstreetmap")


def _geocode(lat: float, lon: float) -> dict | None:
    for provider in (_google, _locationiq, _geoapify, _nominatim):
        try:
            place = provider(lat, lon)
        except (urllib.error.URLError, TimeoutError, ValueError, OSError) as exc:
            logger.warning("%s reverse geocoding failed: %s", provider.__name__.lstrip("_"), exc)
            continue
        if place and (place["street"] or place["city"] or place["area"]):
            return place
    return None


def finish(place: dict | None, lat: float, lon: float) -> dict | None:
    """The response: the geocoder's address with a street line and Plus Code.

    The landmark is dropped when it only repeats the street or the area.
    """
    if not place:
        return None
    landmark = place.get("landmark")
    if landmark and landmark.lower() in {(place.get(k) or "").lower() for k in ("street", "area", "district", "city")}:
        landmark = None
    return {
        **place,
        "landmark": landmark,
        "street_line": " ".join(p for p in (place["house_number"], place["street"]) if p) or None,
        "plus_code": plus_code(lat, lon),
        "attribution": _attribution(place["source"]),
    }


def _attribution(source: str) -> str:
    base = "Map data © OpenStreetMap contributors"
    return {
        "google": "Map data © Google",
        "locationiq": f"Search by LocationIQ.com · {base}",
        "geoapify": f"Powered by Geoapify · {base}",
    }.get(source, base)


def reverse(lat: float, lon: float) -> dict | None:
    """The address at these coordinates, or None when nothing can say.

    Never raises: a failed lookup leaves the transfer screen showing the city,
    and a transfer is never held up by a map service.
    """
    # Four decimal places is about 11 m, inside a typical phone fix.
    key = (round(lat, 4), round(lon, 4))
    now = time.monotonic()
    with _lock:
        hit = _cache.get(key)
        if hit and now - hit[0] < CACHE_TTL_SECONDS:
            _cache.move_to_end(key)
            return hit[1]

    result = finish(_geocode(lat, lon), lat, lon)
    if result:
        with _lock:
            _cache[key] = (now, result)
            _cache.move_to_end(key)
            while len(_cache) > CACHE_MAX:
                _cache.popitem(last=False)
    return result
