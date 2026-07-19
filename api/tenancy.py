"""Multi-tenant resolution.

Every write carries an institution: either explicitly (the demo bank sends the
institution slug from its URL) or via the API key a provisioned institution was
issued (`Authorization: Bearer fbl_live_...` / `X-API-Key`), which is how a
real bank integrates. The key wins when both are present — it's authenticated,
the slug is only asserted.

Reads take the institution from the logged-in dashboard session and filter on
it, so one tenant can never see another's transactions.
"""
from db import DEFAULT_INSTITUTION_ID, cursor, row_to_dict, slugify_institution


def institution_from_api_key(key: str | None) -> str | None:
    """Resolve a provisioned API key to its institution_id."""
    if not key:
        return None
    with cursor() as cur:
        cur.execute(
            "SELECT institution_id, institution_name FROM api_keys WHERE key = ? AND is_active = 1",
            (key,),
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
    if claimed and institution_exists(claimed):
        return claimed
    return DEFAULT_INSTITUTION_ID


def institution_exists(institution_id: str) -> bool:
    with cursor() as cur:
        cur.execute("SELECT 1 FROM institutions WHERE institution_id = ?", (institution_id,))
        return cur.fetchone() is not None


def get_institution(institution_id: str) -> dict | None:
    with cursor() as cur:
        cur.execute("SELECT * FROM institutions WHERE institution_id = ?", (institution_id,))
        return row_to_dict(cur.fetchone())


def list_institutions() -> list[dict]:
    with cursor() as cur:
        cur.execute("SELECT * FROM institutions ORDER BY created_at ASC")
        return [row_to_dict(r) for r in cur.fetchall()]


def register_institution(institution_id: str, name: str, contact_email: str, type_: str = "Microfinance Bank") -> None:
    with cursor() as cur:
        cur.execute(
            """INSERT INTO institutions (institution_id, name, type, contact_email)
               VALUES (?, ?, ?, ?)
               ON CONFLICT(institution_id) DO UPDATE SET name = excluded.name,
                                                         contact_email = excluded.contact_email""",
            (institution_id, name, type_, contact_email),
        )
