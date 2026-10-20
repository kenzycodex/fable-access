"""Is this transfer being made from somewhere new for the customer?

The previous check compared city names, and names are not places. A browser's
reverse geocoder names Bariga, Ikeja or "Lagos" for the same metro on different
days, so a customer who never left Lagos scored "new city Lagos". This answers
by distance when there are coordinates: a place is new when it is more than
PLACE_RADIUS_KM from every place the customer has transacted from before. Only
when there are no coordinates (no GPS fix, or none on record) does it fall back
to names, and then compares them through normalise_city, which folds a metro's
districts and LGAs into the metro.

Used by the analyzer's location step under the "location_place" weights. The
name-only check stays beside it under "location_city" for versions approved
before this, so shipping it changes no decision.
"""
from __future__ import annotations

import math
import re

from core import privacy
from core.db import cursor

# Wide enough to cover one metro (Ikorodu to Lekki is about 40 km), narrow
# enough that Ibadan (about 110 km from Lagos) or Abeokuta counts as new.
PLACE_RADIUS_KM = 45

# District, neighbourhood and LGA names a geocoder may return, folded into the
# metro a customer would call home. Lower case, without punctuation.
_METROS = {
    "lagos": (
        "lagos island", "lagos mainland", "ikeja", "bariga", "akowonjo", "mushin", "surulere", "yaba", "lekki",
        "victoria island", "ikoyi", "ikorodu", "agege", "alimosho", "oshodi", "isolo", "oshodi isolo", "apapa",
        "ajah", "festac", "festac town", "amuwo odofin", "ojo", "somolu", "shomolu", "kosofe", "ketu", "maryland",
        "gbagada", "ogba", "ojodu", "egbeda", "ikotun", "ejigbo", "epe", "badagry", "eti osa", "ifako ijaiye",
        "ibeju lekki", "magodo", "ilupeju", "anthony", "ogudu", "oworonshoki", "idimu", "igando", "ipaja",
        "ayobo", "abule egba", "iyana ipaja", "obalende", "marina", "ebute metta", "orile", "ijora", "ajegunle",
        "satellite town", "sangotedo", "ikota", "chevron", "agidingbi", "alausa", "opebi", "allen", "ojota",
        "lagos state",
    ),
    "abuja": (
        "garki", "wuse", "wuse 2", "maitama", "asokoro", "gwarinpa", "kubwa", "jabi", "utako", "lugbe", "nyanya",
        "bwari", "gwagwalada", "kuje", "abuja municipal", "amac", "federal capital territory", "fct", "life camp",
        "katampe", "jahi", "apo", "lokogoma", "galadimawa", "durumi", "kado", "wuye", "dutse", "mpape", "karu",
        "abuja fct",
    ),
    "port harcourt": (
        "obio akpor", "rumuokoro", "rumuola", "trans amadi", "diobu", "mile 1", "d line", "gra port harcourt",
        "eliozu", "rumuigbo", "choba", "oyigbo", "eleme", "rivers state",
    ),
    "ibadan": ("ibadan north", "ibadan south west", "ibadan north east", "bodija", "dugbe", "challenge", "oyo state"),
    "kano": ("kano municipal", "nassarawa kano", "fagge", "tarauni", "kano state"),
}
_ALIASES = {district: metro for metro, districts in _METROS.items() for district in districts}


def normalise_city(name: str | None) -> str | None:
    """A city name reduced to the place it means: lower case, punctuation and
    "state"/"city" suffixes removed, a metro's districts folded into the metro."""
    if not name:
        return None
    key = re.sub(r"[^a-z0-9 ]+", " ", name.lower())
    key = re.sub(r"\s+", " ", key).strip()
    for suffix in (" state", " city", " metropolis", " lga"):
        stripped = key[: -len(suffix)]
        if key.endswith(suffix) and (stripped in _ALIASES or stripped in _METROS):
            key = stripped
            break
    return _ALIASES.get(key, key) or None


def haversine_km(a: tuple[float, float], b: tuple[float, float]) -> float:
    lat1, lon1, lat2, lon2 = map(math.radians, (a[0], a[1], b[0], b[1]))
    h = math.sin((lat2 - lat1) / 2) ** 2 + math.cos(lat1) * math.cos(lat2) * math.sin((lon2 - lon1) / 2) ** 2
    return 6371 * 2 * math.asin(math.sqrt(h))


def usual_places(user_id: str) -> list[tuple[float, float]]:
    """Every place (about 1 km) the customer has transacted from before."""
    try:
        with cursor() as cur:
            cur.execute("SELECT DISTINCT latitude, longitude FROM user_locations WHERE user_id = ? "
                        "AND latitude IS NOT NULL AND longitude IS NOT NULL", (user_id,))
            return [(r["latitude"], r["longitude"]) for r in cur.fetchall()]
    except Exception:  # noqa: BLE001 - a missing location history must never stop scoring
        return []


def new_place(latitude, longitude, city: str | None, usual: list[tuple[float, float]],
              known_cities: set[str]) -> tuple[bool, float | None]:
    """(is this a new place, km to the nearest usual place when measured).

    By distance when this transfer and the customer's history both have
    coordinates; otherwise by normalised city name; otherwise not new (no
    evidence either way is not evidence of a new place)."""
    here = (privacy.coarse(latitude), privacy.coarse(longitude))
    if here[0] is not None and here[1] is not None and usual:
        nearest = min(haversine_km(here, u) for u in usual)
        return nearest > PLACE_RADIUS_KM, nearest
    if city and known_cities:
        known = {normalise_city(c) for c in known_cities}
        return normalise_city(city) not in known, None
    return False, None
