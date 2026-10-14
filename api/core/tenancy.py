"""Multi-tenant resolution.

Every write carries an institution: either explicitly (the demo bank sends the
institution slug from its URL) or via the API key a provisioned institution was
issued (`Authorization: Bearer fbl_live_...` / `X-API-Key`), which is how a
real bank integrates. The key wins when both are present — it's authenticated,
the slug is only asserted.

Reads take the institution from the logged-in dashboard session and filter on
it, so one tenant can never see another's transactions.
"""
from fastapi import Request

from core.db import DEFAULT_INSTITUTION_ID, cursor, row_to_dict, slugify_institution


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


def resolve_institution(request, claimed: str | None = None) -> str:
    """The institution a write belongs to.

    Precedence: authenticated API key > slug claimed by the client > default.
    An unknown claimed slug falls back to the default rather than creating a
    phantom tenant, so a typo in the URL can't silently fork the data.
    """
    from_key = institution_from_api_key(extract_api_key(request))
    if from_key:
        return from_key
    claimed = canonical_institution(claimed)
    if claimed and institution_exists(claimed):
        # A live institution's traffic is real money. Naming it is not enough
        # to write to it: the caller must hold its key. Sandbox institutions,
        # including every demo bank, stay open so the public demo keeps working.
        if institution_mode(claimed) == "live":
            from fastapi import HTTPException

            raise HTTPException(
                status_code=401,
                detail="This institution is live. Present its API key to send transactions.",
            )
        return claimed
    return _fallback_institution()


def _fallback_institution() -> str:
    """The tenant to attribute a write to when nothing identifies one.

    This used to return DEFAULT_INSTITUTION_ID unconditionally, which is only
    correct while that institution exists. After re-provisioning it does not,
    so unattributed writes were tagged to a tenant with no institutions row —
    orphaning them exactly the way the old 'demo_bank' default did.

    Prefers the configured default when it is real, then falls back to the only
    institution when there is exactly one. With several tenants and nothing
    identifying the caller there is no safe guess, so the configured default
    stands and the caller should be sending a key.
    """
    if institution_exists(DEFAULT_INSTITUTION_ID):
        return DEFAULT_INSTITUTION_ID
    with cursor() as cur:
        cur.execute("SELECT institution_id FROM institutions ORDER BY created_at ASC LIMIT 2")
        rows = cur.fetchall()
    return rows[0]["institution_id"] if len(rows) == 1 else DEFAULT_INSTITUTION_ID


def tenant_for_read(request, claimed: str | None = None) -> str:
    """The institution a dashboard read is allowed to see.

    Every console read used to take its tenant from an `institution` query
    parameter bound to no identity at all, so `?institution=<other_bank>`
    returned their data, and omitting the parameter aggregated *every* tenant.

    Precedence, strongest first:

      1. A verified session token. The console presents one on every call, and
         the institution inside it is signed, so it cannot be edited.
      2. A provisioned API key, which is how an integrating bank authenticates.
      3. The claimed slug, only while no credential is present at all.

    Step 3 is a deliberate, temporary allowance so the demo bank keeps working
    while the console migrates; it disappears with the query parameter itself.
    A caller that presents a credential can never widen its scope by also
    passing a slug.
    """
    from core import sessions

    try:
        return sessions.verify(sessions.extract_token(request))["inst"]
    except sessions.SessionError:
        pass

    from_key = institution_from_api_key(extract_api_key(request))
    if from_key:
        return from_key

    claimed = canonical_institution(claimed)
    if claimed and institution_exists(claimed):
        return claimed
    return _fallback_institution()


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
            return {
                "inst": payload["inst"],
                "email": payload.get("sub"),
                "name": row["name"],
                "role": row["role"] or "owner",
            }
        return {"inst": payload["inst"], "email": payload.get("sub"), "name": None, "role": "owner"}

    from_key = institution_from_api_key(extract_api_key(request))
    if from_key:
        return {"inst": from_key, "email": "api-key", "name": "API key", "role": "service"}

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


def _subject_institution(request, body: dict) -> str | None:
    """Which institution a customer-facing request is about, from what it names."""
    params = request.path_params
    with cursor() as cur:
        if params.get("ghost_id"):
            cur.execute("SELECT institution_id FROM ghost_containers WHERE ghost_id = ?", (params["ghost_id"],))
            row = cur.fetchone()
            return row["institution_id"] if row else None
        if params.get("txid"):
            cur.execute("SELECT institution_id FROM transactions WHERE id = ?", (params["txid"],))
            row = cur.fetchone()
            return row["institution_id"] if row else None
    user_id = params.get("user_id") or (body.get("user_id") if isinstance(body, dict) else None)
    if not user_id:
        return None
    from services import audit

    return audit._institution_of(str(user_id))


async def customer_scope(request: Request) -> None:
    """Guard for the customer-facing API (balances, verification, holds, approvals).

    A live institution's traffic is real customers' money, so a request about one
    of its customers must carry that institution's API key, sent from the bank's
    own servers. Without this, live mode protected scoring but left every other
    customer endpoint open to anyone who knew a customer id. Sandbox institutions,
    including every demo bank, are unaffected.
    """
    from fastapi import HTTPException

    body: dict = {}
    if request.method in ("POST", "PUT", "PATCH") and "json" in request.headers.get("content-type", ""):
        try:
            body = await request.json()  # Starlette caches it; the route still reads it normally
        except Exception:  # noqa: BLE001 - a malformed body is the route's error to report
            body = {}

    institution = _subject_institution(request, body)
    if not institution or institution_mode(institution) != "live":
        return
    if institution_from_api_key(extract_api_key(request)) != institution:
        raise HTTPException(
            status_code=401,
            detail="This institution is live. Requests about its customers must carry its API key.",
        )


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
