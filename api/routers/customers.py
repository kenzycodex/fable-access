"""A bank's own customers, for its console.

Every route reads the bank from the caller's console session or API key, and
only ever returns that bank's customers.
"""
from fastapi import APIRouter, HTTPException, Query, Request

from core import customers
from core.tenancy import require_role

router = APIRouter(prefix="/v1/customers", tags=["customers"])


@router.get("")
def list_customers(
    request: Request,
    q: str | None = Query(None, max_length=80),
    kind: str | None = Query(None),
    status: str | None = Query(None),
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
):
    """This bank's customers, newest first, with search and filters."""
    institution_id = require_role(request, "viewer")["inst"]
    rows, total = customers.listing(institution_id, q=q, kind=kind, status=status, limit=limit, offset=offset)
    return {"customers": [customers.public(c) for c in rows], "total": total}


@router.get("/{customer_id}")
def get_customer(customer_id: str, request: Request):
    """One of this bank's customers, by Fable id or by the bank's reference."""
    institution_id = require_role(request, "viewer")["inst"]
    customer = customers.get(institution_id, customer_id)
    if not customer:
        raise HTTPException(status_code=404, detail="Customer not found.")
    return customers.public(customer)
