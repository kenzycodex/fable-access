"""The sandbox app's view of a bank: its test customers.

The sandbox is a test banking app a bank's own team uses to try Fable before
going live. It needs the console sign-in of that bank, and it only ever sees the
bank's test customers, never its real ones.
"""
from fastapi import APIRouter, HTTPException, Request

from core import customers
from core.tenancy import institution_mode, require_role

router = APIRouter(prefix="/v1/sandbox", tags=["sandbox"])


@router.get("/customers")
def test_customers(request: Request):
    """The bank's active test customers, for the sandbox app's customer picker."""
    who = require_role(request, "viewer")
    institution_id = who["inst"]
    if institution_mode(institution_id) == "live":
        raise HTTPException(status_code=409, detail="The sandbox app is switched off while the institution is live.")
    rows, _total = customers.listing(institution_id, kind="test", status="active", limit=200)
    return {
        "institution_id": institution_id,
        "customers": [
            {
                "user_id": c["id"],
                "reference": c["external_ref"],
                "name": c.get("display_name") or c["external_ref"],
                "segment": c.get("segment"),
            }
            for c in rows
        ],
    }
