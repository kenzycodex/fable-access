"""Name the place at a device's coordinates.

The browser reads the coordinates from the phone's own location service and
asks here for the address, so provider keys never leave the server.
"""
import threading
import time
from collections import defaultdict, deque

from fastapi import APIRouter, HTTPException, Query, Request

from core.tenancy import console_identity
from services import geocoding

router = APIRouter(prefix="/v1/geo", tags=["geo"])

# Lookups per institution per minute. Each one can spend a paid map-provider
# call, so a bank's credential is required and its use is capped. Per process,
# like the global rate limiter.
PER_INSTITUTION_PER_MINUTE = 60
_hits: dict[str, deque] = defaultdict(deque)
_lock = threading.Lock()


def _limit(institution_id: str) -> None:
    now = time.monotonic()
    with _lock:
        hits = _hits[institution_id]
        while hits and now - hits[0] > 60:
            hits.popleft()
        if len(hits) >= PER_INSTITUTION_PER_MINUTE:
            raise HTTPException(status_code=429, detail="Too many address lookups. Try again in a minute.")
        hits.append(now)


@router.get("/reverse")
def reverse(
    request: Request,
    lat: float = Query(..., ge=-90, le=90),
    lon: float = Query(..., ge=-180, le=180),
):
    """Nearest street, area, landmark and Plus Code for a coordinate pair.

    Needs a console session or the bank's API key (it was open to anyone, and
    every call can spend the provider quota). Coordinates are rounded to about
    11 metres before the lookup, which also lets nearby repeats hit the cache.
    404 when no map service could name the place; the client then shows the
    city it already has.
    """
    who = console_identity(request)
    _limit(who["inst"])
    place = geocoding.reverse(round(lat, 4), round(lon, 4))
    if not place:
        raise HTTPException(status_code=404, detail="No address found at this location.")
    return place
