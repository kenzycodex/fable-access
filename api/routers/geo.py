"""Name the place at a device's coordinates.

The browser reads the coordinates from the phone's own location service and
asks here for the address, so the Google key never leaves the server.
"""
from fastapi import APIRouter, HTTPException, Query

import geocoding

router = APIRouter(prefix="/v1/geo", tags=["geo"])


@router.get("/reverse")
def reverse(
    lat: float = Query(..., ge=-90, le=90),
    lon: float = Query(..., ge=-180, le=180),
):
    """Street address for a coordinate pair.

    503 when no Google key is configured, 404 when Google has no address there.
    Either way the client falls back to OpenStreetMap, so the transfer screen
    still shows a place.
    """
    if not geocoding.available():
        raise HTTPException(status_code=503, detail="Address lookup is not configured.")
    place = geocoding.reverse(lat, lon)
    if not place:
        raise HTTPException(status_code=404, detail="No address found at this location.")
    return place
