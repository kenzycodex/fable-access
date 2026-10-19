"""How precise the personal data Fable keeps is allowed to be.

Scoring only ever reads a transfer's city and country (location_anomaly) and
never the coordinates or the IP address, so neither needs to be stored
precisely:

  coordinates  rounded to 2 decimal places, about 1.1 km at the equator: a
               neighbourhood, never a building
  IP address   IPv4 keeps its first three parts (a.b.c.0), IPv6 its first 48
               bits, enough to tell a network apart, not a household

Applied when a decision or a location is written, and once to rows stored
before this (backfill_precision), so a database copy holds no exact location
or full IP address.
"""
from __future__ import annotations

import ipaddress

COORD_PLACES = 2


def coarse(value) -> float | None:
    """A latitude or longitude rounded to about 1 km, or None."""
    if value is None or value == "":
        return None
    try:
        return round(float(value), COORD_PLACES)
    except (TypeError, ValueError):
        return None


def truncate_ip(value) -> str | None:
    """An IP address with its host part removed, or None when it is not one."""
    if not value:
        return None
    try:
        ip = ipaddress.ip_address(str(value).strip())
    except ValueError:
        return None
    prefix = 24 if ip.version == 4 else 48
    return str(ipaddress.ip_network(f"{ip}/{prefix}", strict=False).network_address)


def backfill_precision(conn) -> int:
    """Coarsen coordinates and IP addresses stored before this module existed.
    Idempotent: rows already coarse are left alone. Returns rows changed."""
    changed = 0
    for table in ("transactions", "user_locations"):
        cur = conn.execute(
            f"""UPDATE {table} SET latitude = round(latitude, {COORD_PLACES}), longitude = round(longitude, {COORD_PLACES})
                WHERE (latitude IS NOT NULL AND latitude != round(latitude, {COORD_PLACES}))
                   OR (longitude IS NOT NULL AND longitude != round(longitude, {COORD_PLACES}))"""
        )
        changed += cur.rowcount or 0
    # Truncated addresses end in ".0" or "::", so later starts skip them.
    rows = conn.execute("SELECT id, client_ip FROM transactions WHERE COALESCE(client_ip, '') != '' "
                        "AND client_ip NOT LIKE '%.0' AND client_ip NOT LIKE '%::'").fetchall()
    for txid, ip in rows:
        cut = truncate_ip(ip)
        if cut != ip:
            conn.execute("UPDATE transactions SET client_ip = ? WHERE id = ?", (cut, txid))
            changed += 1
    return changed
