"""A bank's customers, and the only way to look one up.

A bank knows its customer by its own reference (`external_ref`: an account or
CIF number, say). Fable keys every row by `id`, which is unique across banks.
Every lookup here is scoped to one institution, so a reference or id that
belongs to another bank is simply not found: there is no global lookup to
misuse.
"""
from __future__ import annotations

import re
import secrets

from core.db import cursor, row_to_dict

KINDS = ("test", "real")
STATUSES = ("active", "closed")
SOURCES = ("console", "csv", "api")

# Bank references are identifiers, not free text: letters, digits and a few
# separators, so they are safe in a URL path and cannot smuggle markup.
REF_PATTERN = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_.:\-]{0,63}$")


class CustomerError(ValueError):
    """A customer request that cannot be applied, with a message for the caller."""


def new_id() -> str:
    return f"cus_{secrets.token_hex(8)}"


def valid_ref(ref: str | None) -> bool:
    return bool(ref) and bool(REF_PATTERN.match(ref))


def get(institution_id: str, value: str | None) -> dict | None:
    """The customer this bank calls `value`, by Fable id or by its own reference."""
    if not institution_id or not value:
        return None
    with cursor() as cur:
        cur.execute(
            """SELECT * FROM customers
               WHERE institution_id = ? AND (id = ? OR external_ref = ?)
               ORDER BY (id = ?) DESC LIMIT 1""",
            (institution_id, value, value, value),
        )
        return row_to_dict(cur.fetchone())


def exists_elsewhere(institution_id: str, value: str) -> bool:
    """Whether `value` names a customer at some other bank. Used only to record
    a cross-bank attempt in the audit log; never returned to the caller."""
    with cursor() as cur:
        cur.execute(
            "SELECT 1 FROM customers WHERE institution_id != ? AND (id = ? OR external_ref = ?) LIMIT 1",
            (institution_id, value, value),
        )
        return cur.fetchone() is not None


def create(
    institution_id: str,
    external_ref: str,
    *,
    kind: str,
    source: str,
    display_name: str | None = None,
    phone: str | None = None,
    email: str | None = None,
    segment: str | None = None,
) -> dict:
    """Add a customer. Raises CustomerError if the reference is taken or invalid."""
    external_ref = (external_ref or "").strip()
    if not valid_ref(external_ref):
        raise CustomerError("Customer reference must be 1-64 letters, digits, or . _ : - characters.")
    if kind not in KINDS or source not in SOURCES:
        raise CustomerError("Unknown customer kind or source.")
    if get(institution_id, external_ref):
        raise CustomerError(f"A customer with reference {external_ref} already exists.")
    customer_id = new_id()
    with cursor() as cur:
        cur.execute(
            """INSERT INTO customers
                   (id, institution_id, external_ref, display_name, phone, email, segment, kind, source)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            (customer_id, institution_id, external_ref, _clean(display_name, 120),
             _clean(phone, 32), _clean(email, 254), _clean(segment, 60), kind, source),
        )
    return get(institution_id, customer_id)


def ensure(institution_id: str, external_ref: str, *, kind: str, source: str) -> dict:
    """The customer with this reference, created on first sight.

    How a bank's live traffic enrols its customers: the first transfer scored
    for a reference creates it. Only the scoring endpoint does this; every other
    customer endpoint needs the customer to exist already.
    """
    found = get(institution_id, external_ref)
    if found:
        return found
    try:
        return create(institution_id, external_ref, kind=kind, source=source)
    except CustomerError:
        # Lost a race with a concurrent first transfer, or an invalid reference.
        found = get(institution_id, external_ref)
        if found:
            return found
        raise


def update(institution_id: str, value: str, **fields) -> dict:
    """Change a customer's name, contact, segment or status."""
    customer = get(institution_id, value)
    if not customer:
        raise CustomerError("Customer not found.")
    allowed = {"display_name": 120, "phone": 32, "email": 254, "segment": 60}
    sets, args = [], []
    for name, limit in allowed.items():
        if name in fields and fields[name] is not None:
            sets.append(f"{name} = ?")
            args.append(_clean(fields[name], limit))
    if fields.get("status") is not None:
        if fields["status"] not in STATUSES:
            raise CustomerError("Status must be active or closed.")
        sets.append("status = ?")
        args.append(fields["status"])
    if not sets:
        return customer
    sets.append("updated_at = datetime('now')")
    with cursor() as cur:
        cur.execute(
            f"UPDATE customers SET {', '.join(sets)} WHERE id = ? AND institution_id = ?",
            (*args, customer["id"], institution_id),
        )
    return get(institution_id, customer["id"])


def listing(
    institution_id: str,
    *,
    q: str | None = None,
    kind: str | None = None,
    status: str | None = None,
    limit: int = 50,
    offset: int = 0,
) -> tuple[list[dict], int]:
    """A page of this bank's customers, newest first, and the total."""
    where, args = ["institution_id = ?"], [institution_id]
    if kind in KINDS:
        where.append("kind = ?")
        args.append(kind)
    if status in STATUSES:
        where.append("status = ?")
        args.append(status)
    if q:
        like = f"%{q.strip()}%"
        where.append("(display_name LIKE ? OR external_ref LIKE ? OR email LIKE ? OR phone LIKE ?)")
        args += [like, like, like, like]
    clause = " AND ".join(where)
    with cursor() as cur:
        cur.execute(f"SELECT COUNT(*) FROM customers WHERE {clause}", args)
        total = cur.fetchone()[0]
        cur.execute(
            f"SELECT * FROM customers WHERE {clause} ORDER BY created_at DESC, id LIMIT ? OFFSET ?",
            (*args, limit, offset),
        )
        rows = [row_to_dict(r) for r in cur.fetchall()]
    return rows, total


def names(institution_id: str, ids: list[str]) -> dict[str, dict]:
    """Display name and bank reference for each of these customer ids."""
    unique = sorted({i for i in ids if i})
    if not unique:
        return {}
    marks = ",".join("?" * len(unique))
    with cursor() as cur:
        cur.execute(
            f"SELECT id, external_ref, display_name FROM customers WHERE institution_id = ? AND id IN ({marks})",
            (institution_id, *unique),
        )
        return {r["id"]: {"ref": r["external_ref"], "name": r["display_name"]} for r in cur.fetchall()}


def public(customer: dict) -> dict:
    """The fields a bank sees about its own customer."""
    return {
        "id": customer["id"],
        "reference": customer["external_ref"],
        "name": customer.get("display_name"),
        "phone": customer.get("phone"),
        "email": customer.get("email"),
        "segment": customer.get("segment"),
        "kind": customer.get("kind"),
        "status": customer.get("status"),
        "source": customer.get("source"),
        "created_at": customer.get("created_at"),
    }


def _clean(value: str | None, limit: int) -> str | None:
    if value is None:
        return None
    text = "".join(ch for ch in str(value) if ch.isprintable()).strip()
    return text[:limit] or None
