"""A bank's own customers, for its console.

Every route reads the bank from the caller's console session or API key, and
only ever returns that bank's customers.
"""
from fastapi import APIRouter, HTTPException, Query, Request
from pydantic import BaseModel, Field

from core import customers
from core.tenancy import institution_mode, require_role
from services import audit, imports

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


class NewCustomer(BaseModel):
    reference: str = Field(min_length=1, max_length=64)
    name: str | None = Field(None, max_length=120)
    phone: str | None = Field(None, max_length=32)
    email: str | None = Field(None, max_length=254)
    segment: str | None = Field(None, max_length=60)
    # test (sandbox only) or real. Defaults to test in the sandbox, real when live.
    kind: str | None = None
    # A test customer's starting balance in the sandbox ledger.
    opening_balance: float | None = Field(None, ge=0)


@router.post("", status_code=201)
def add_customer(body: NewCustomer, request: Request):
    """Add one customer by hand. Owners and analysts."""
    who = require_role(request, "analyst")
    institution_id = who["inst"]
    sandbox = institution_mode(institution_id) != "live"
    row = body.model_dump()
    row["kind"] = row.get("kind") or ("test" if sandbox else "real")
    if row["kind"] == "test" and not sandbox:
        raise HTTPException(status_code=400, detail="Test customers are for the sandbox. This institution is live.")
    data, problems = imports.validate_customer(row, sandbox=sandbox)
    if problems:
        raise HTTPException(status_code=400, detail="; ".join(f"{f}: {m}" for f, m in problems))
    if customers.get(institution_id, data["reference"]):
        raise HTTPException(status_code=409, detail=f"A customer with reference {data['reference']} already exists.")
    inserted, _skipped, errors = imports.apply_rows(institution_id, "customers", [data], source="console")
    if errors or not inserted:
        raise HTTPException(status_code=400, detail=errors[0]["message"] if errors else "Customer not added.")
    created = customers.get(institution_id, data["reference"])
    audit.record(audit.CUSTOMER_CREATED, created["id"], institution_id=institution_id,
                 reference=created["external_ref"], kind=created["kind"], admin=who["email"])
    return customers.public(created)


class CustomerPatch(BaseModel):
    name: str | None = Field(None, max_length=120)
    phone: str | None = Field(None, max_length=32)
    email: str | None = Field(None, max_length=254)
    segment: str | None = Field(None, max_length=60)
    status: str | None = None


@router.patch("/{customer_id}")
def edit_customer(customer_id: str, body: CustomerPatch, request: Request):
    """Change a customer's name, contact details, segment, or close them."""
    who = require_role(request, "analyst")
    institution_id = who["inst"]
    try:
        updated = customers.update(
            institution_id, customer_id,
            display_name=body.name, phone=body.phone, email=body.email,
            segment=body.segment, status=body.status,
        )
    except customers.CustomerError as exc:
        code = 404 if "not found" in str(exc).lower() else 400
        raise HTTPException(status_code=code, detail=str(exc)) from exc
    audit.record(audit.CUSTOMER_UPDATED, updated["id"], institution_id=institution_id,
                 fields=[k for k, v in body.model_dump().items() if v is not None], admin=who["email"])
    return customers.public(updated)
