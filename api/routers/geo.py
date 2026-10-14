"""Name the place at a device's coordinates.

The browser reads the coordinates from the phone's own location service and
asks here for the address, so provider keys never leave the server.
"""
from fastapi import APIRouter, HTTPException, Query

import geocoding

router = APIRouter(prefix="/v1/geo", tags=["geo"])


@router.get("/reverse")
def reverse(
    lat: float = Query(..., ge=-90, le=90),
    lon: float = Query(..., ge=-180, le=180),
):
    """Nearest street, area, landmark and Plus Code for a coordinate pair.

    404 when no map service could name the place; the client then shows the
    city it already has.
    """
    place = geocoding.reverse(lat, lon)
    if not place:
        raise HTTPException(status_code=404, detail="No address found at this location.")
    return place
