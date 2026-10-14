"""Which bank a request acts for, and what it may touch.

A bank is identified by a credential and nothing else:

  * its API key (`Authorization: Bearer fbl_live_...` or `X-API-Key`), which
    is how its own servers integrate; or
  * a console session, signed by Fable, naming the bank and the member.

A bank named in a URL, query string or request body is never trusted. There is
no default bank and no fallback: a request without a credential is refused.
Every customer, hold and transaction is then checked against the caller's bank,
and anything that belongs to another bank is reported as not found.

This follows the access-enforcement and least-privilege controls of the CBN's
risk-based cybersecurity framework, and keeps each bank's data separate as a
processor must under the NDPA.
"""
from fastapi import HTTPException, Request

from core.db import cursor, row_to_dict, slugify_institution


def institution_from_api_key(key: str | None) -> str | None:
    """Resolve a provisioned API key to its institution_id."""
    if not key:
        return None
    from core import apikeys

    with cursor() as cur:
        cur.execute(
            "SELECT institution_id, institution_name FROM api_keys WHERE key = ? AND is_active = 1",
            (apikeys.hash_key(key),),
        )
        row = cur.fetchone()
    if not row:
        return None
    return row["institution_id"] or slugify_institution(row["institution_name"])


def extract_api_key(request) -> str | None:
    auth = request.headers.get("authorization", "")
    if auth.lower().startswith("bearer "):
        return auth[7:].strip()
    return request.headers.get("x-api-key")


def caller_institution(request) -> str:
    """The bank this request acts for, from its credential. 401 without one."""
    return console_identity(request)["inst"]


def tenant_for_console(request) -> str:
    """The institution a *console* read is allowed to see. Credential required.

    `tenant_for_read` tolerates an unauthenticated caller: it accepts a claimed
    slug, and failing that falls back to the only institution on the box. That
    is defensible for the demo bank, whose slug is in its own public URL and
    whose data is a sandbox.

    It is not defensible for the institution console. Those endpoints return the
    bank's customer ids, recipient account numbers, narrations and device
    fingerprints, and the fallback meant that on a single-tenant deployment —
    which is every deployment right now — an unauthenticated GET returned all of
    it. Closing S0-4 on the console while leaving that path open would have been
    closing it on paper only.

    No session and no API key is a 401, with no fallback. A session for a
    member who has since been deactivated is also a 401.
    """
    return console_identity(request)["inst"]


ROLES = ("owner", "analyst", "viewer")

# What each role may do. An API key acts as "service": a machine integration may
# read and work cases, but managing people, keys and policy needs a person.
_ROLE_RANK = {"viewer": 0, "analyst": 1, "service": 1, "owner": 2}


def console_identity(request) -> dict:
    """Who is calling the console API: institution, email and role.

    The role is read from the admins table on every call rather than trusted
    from the token. Tokens live for 12 hours and cannot be revoked, so a role
    baked into one would let a demoted or removed member keep their old powers
    until it expired.
    """
    from fastapi import HTTPException

    from core import sessions

    try:
        payload = sessions.verify(sessions.extract_token(request))
    except sessions.SessionError:
        payload = None

    if payload:
        with cursor() as cur:
            cur.execute(
                "SELECT role, name, active, institution_id, COALESCE(session_version, 0) AS sv FROM admins WHERE email = ?",
                (payload.get("sub"),),
            )
            row = cur.fetchone()
        # A session minted before this check existed, or by a test, may name an
        # admin with no row. It still proves the institution, so it keeps the
        # access it always had; a row that exists must be active and match.
        if row is not None:
            if not row["active"] or row["institution_id"] != payload["inst"]:
                raise HTTPException(status_code=401, detail="This account no longer has console access.")
            if int(payload.get("sv", 0) or 0) != int(row["sv"]):
                raise HTTPException(status_code=401, detail="Your password was changed, so this session ended. Sign in again.")
            return _active({
                "inst": payload["inst"],
                "email": payload.get("sub"),
                "name": row["name"],
                "role": row["role"] or "owner",
            })
        return _active({"inst": payload["inst"], "email": payload.get("sub"), "name": None, "role": "owner"})

    from_key = institution_from_api_key(extract_api_key(request))
    if from_key:
        return _active({"inst": from_key, "email": "api-key", "name": "API key", "role": "service"})

    raise HTTPException(
        status_code=401,
        detail="Sign in to the console, or present your institution's API key.",
    )


def require_role(request, minimum: str) -> dict:
    """The caller's identity, or 403 when their role is below `minimum`.

    `minimum` is "viewer", "analyst" or "owner". Owner-only actions also refuse
    an API key: changing people, keys or policy should be done by a person.
    """
    from fastapi import HTTPException

    who = console_identity(request)
    if minimum == "owner" and who["role"] != "owner":
        raise HTTPException(status_code=403, detail="Only an owner can change this.")
    if _ROLE_RANK.get(who["role"], 0) < _ROLE_RANK[minimum]:
        raise HTTPException(status_code=403, detail="Your role cannot do this.")
    return who


def _active(identity: dict) -> dict:
    """The identity, unless its bank has been suspended by a Fable operator."""
    if institution_status(identity["inst"]) == "suspended":
        raise HTTPException(
            status_code=403,
            detail="This institution's access is suspended. Contact Fable support.",
        )
    return identity


def institution_status(institution_id: str | None) -> str:
    """'active' or 'suspended'."""
    if not institution_id:
        return "active"
    try:
        with cursor() as cur:
            cur.execute("SELECT status FROM institutions WHERE institution_id = ?", (institution_id,))
            row = cur.fetchone()
        return (row["status"] if row and row["status"] else "active").lower()
    except Exception:  # noqa: BLE001 - a database without the column yet
        return "active"


def _not_found(what: str) -> HTTPException:
    return HTTPException(status_code=404, detail=f"{what} not found.")


def _record_cross_bank(institution_id: str, target: str, kind: str) -> None:
    """Note an attempt to reach another bank's record, without saying whose."""
    try:
        from services import audit

        audit.record(audit.ACCESS_DENIED, None, institution_id=institution_id, target_kind=kind, target=target)
    except Exception:  # noqa: BLE001 - auditing must never change the response
        pass


def _owned(table: str, key_column: str, value: str, institution_id: str, what: str) -> None:
    """404 unless the row exists and belongs to this bank."""
    with cursor() as cur:
        cur.execute(f"SELECT institution_id FROM {table} WHERE {key_column} = ?", (value,))
        row = cur.fetchone()
    if not row:
        raise _not_found(what)
    if row["institution_id"] != institution_id:
        _record_cross_bank(institution_id, value, what.lower())
        raise _not_found(what)


async def _json_body(request: Request) -> dict:
    if request.method not in ("POST", "PUT", "PATCH"):
        return {}
    if "json" not in request.headers.get("content-type", ""):
        return {}
    try:
        body = await request.json()  # Starlette caches it; the route reads the same object
    except Exception:  # noqa: BLE001 - a malformed body is the route's error to report
        return {}
    return body if isinstance(body, dict) else {}


async def _guard(request: Request, create: bool) -> None:
    from core import customers

    who = console_identity(request)
    institution_id = who["inst"]
    mode = institution_mode(institution_id)

    # A live bank's customers are real people with real money. Requests about
    # them come from the bank's own servers with its key; a console member's
    # browser session is for working cases, not for moving customers' money.
    if mode == "live" and who["role"] != "service":
        raise HTTPException(
            status_code=403,
            detail="This institution is live. Customer requests must come from its servers, with its API key.",
        )

    params = request.scope.setdefault("path_params", {})
    body = await _json_body(request)

    if params.get("ghost_id"):
        _owned("ghost_containers", "ghost_id", params["ghost_id"], institution_id, "Hold")
    for key in ("txid", "transaction_id"):
        if params.get(key):
            _owned("transactions", "id", params[key], institution_id, "Transaction")

    ref = params.get("user_id") or body.get("user_id")
    if ref:
        ref = str(ref)
        customer = customers.get(institution_id, ref)
        if not customer and create:
            try:
                customer = customers.ensure(
                    institution_id, ref,
                    kind="real" if mode == "live" else "test",
                    source="api",
                )
            except customers.CustomerError as exc:
                raise HTTPException(status_code=422, detail=str(exc)) from exc
        if not customer:
            if customers.exists_elsewhere(institution_id, ref):
                _record_cross_bank(institution_id, ref, "customer")
            raise _not_found("Customer")
        # From here on the route works with Fable's id for this bank's
        # customer, whichever form the caller used. Path parameters and the JSON
        # body are both rewritten, because routes read the customer from either.
        if params.get("user_id"):
            params["user_id"] = customer["id"]
        if body.get("user_id"):
            body["user_id"] = customer["id"]
        request.state.customer = customer

    # Any institution named in the body is replaced by the caller's own, so a
    # route that still reads it can only ever see the right bank.
    if "institution_id" in body:
        body["institution_id"] = institution_id

    request.state.institution_id = institution_id
    request.state.mode = mode
    request.state.caller = who


async def customer_guard(request: Request) -> None:
    """Guard for every customer-facing endpoint (balances, verification, holds,
    approvals, notifications). The customer, hold or transaction must belong to
    the caller's bank; anything else is not found."""
    await _guard(request, create=False)


async def scoring_guard(request: Request) -> None:
    """As customer_guard, but a reference the bank has not used before enrols a
    new customer: scoring a transfer is how live traffic introduces customers."""
    await _guard(request, create=True)


def institution_mode(institution_id: str | None) -> str:
    """'live' or 'sandbox'. Unknown or unset is sandbox, the historical behaviour."""
    if not institution_id:
        return "sandbox"
    try:
        with cursor() as cur:
            cur.execute("SELECT mode FROM institutions WHERE institution_id = ?", (institution_id,))
            row = cur.fetchone()
        return (row["mode"] if row and row["mode"] else "sandbox").lower()
    except Exception:  # noqa: BLE001 - a database without the column yet
        return "sandbox"


def institution_exists(institution_id: str) -> bool:
    with cursor() as cur:
        cur.execute("SELECT 1 FROM institutions WHERE institution_id = ?", (institution_id,))
        return cur.fetchone() is not None


def canonical_institution(institution_id: str | None) -> str | None:
    """The current id for an institution id someone may still be using.

    A renamed institution's old id lives on as an alias. Anything that arrives
    carrying it (an old link, a stale browser tab, a setting that was never
    updated) is mapped to the institution's present id instead of being treated
    as unknown. An id that exists is returned as it is, and an unknown one comes
    back unchanged so callers keep their existing "not found" handling.
    """
    if not institution_id or institution_exists(institution_id):
        return institution_id
    try:
        with cursor() as cur:
            cur.execute("SELECT institution_id FROM institution_aliases WHERE alias = ?", (institution_id,))
            row = cur.fetchone()
        return row["institution_id"] if row else institution_id
    except Exception:  # noqa: BLE001 - a database without the table yet
        return institution_id


def get_institution(institution_id: str) -> dict | None:
    with cursor() as cur:
        cur.execute("SELECT * FROM institutions WHERE institution_id = ?", (institution_id,))
        return row_to_dict(cur.fetchone())


def list_institutions() -> list[dict]:
    with cursor() as cur:
        cur.execute("SELECT * FROM institutions ORDER BY created_at ASC")
        return [row_to_dict(r) for r in cur.fetchall()]


def register_institution(institution_id: str, name: str, contact_email: str, type_: str = "Financial Institution") -> None:
    with cursor() as cur:
        cur.execute(
            """INSERT INTO institutions (institution_id, name, type, contact_email)
               VALUES (?, ?, ?, ?)
               ON CONFLICT(institution_id) DO UPDATE SET name = excluded.name,
                                                         contact_email = excluded.contact_email""",
            (institution_id, name, type_, contact_email),
        )


def disabled_agents(institution_id: str | None) -> set[str]:
    """Add-on agents this institution has switched off.

    The console has had Shield/Ghost/Watch toggles since it was built and
    nothing ever read them, so turning an agent off changed nothing. Copilot is
    never disableable: it is the baseline engine every other agent scores
    against.
    """
    if not institution_id:
        return set()
    try:
        with cursor() as cur:
            cur.execute(
                "SELECT agents_disabled FROM institutions WHERE institution_id = ?",
                (institution_id,),
            )
            row = cur.fetchone()
        raw = (row["agents_disabled"] if row else None) or ""
        return {a.strip().lower() for a in raw.split(",") if a.strip() and a.strip().lower() != "copilot"}
    except Exception:
        return set()


def set_disabled_agents(institution_id: str, disabled: set[str]) -> None:
    keep = sorted(a.lower() for a in disabled if a.lower() != "copilot")
    with cursor() as cur:
        cur.execute(
            "UPDATE institutions SET agents_disabled = ? WHERE institution_id = ?",
            (",".join(keep), institution_id),
        )
