"""The sandbox app's view of a bank: its test customers.

The sandbox is a test banking app a bank's own team uses to try Fable before
going live. It needs the console sign-in of that bank, and it only ever sees the
bank's test customers, never its real ones.
"""
from fastapi import APIRouter, Depends, HTTPException, Query, Request

from core import customers
from core.db import cursor, loads, row_to_dict
from core.tenancy import customer_guard, institution_mode, require_role

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


@router.get("/overview/{user_id}", dependencies=[Depends(customer_guard)])
def customer_overview(user_id: str, request: Request, limit: int = Query(60, ge=1, le=200)):
    """One round-trip for a customer's home screen: balance, recent transfers
    and the learned baseline together.

    Composed in one call so switching customers, or refreshing, is a single
    round trip instead of three."""
    from agents.copilot.transparency import get_transparency_data
    from services import accounts as ledger

    institution = request.state.institution_id
    if request.state.mode == "live":
        raise HTTPException(status_code=409, detail="The sandbox app is switched off while the institution is live.")
    where = "WHERE user_id = ? AND institution_id = ?"
    params: list = [user_id, institution]

    with cursor() as cur:
        cur.execute(
            f"""SELECT id, user_id, amount, recipient_id, recipient_name, recipient_account,
                       recipient_bank, narration, channel, device_fingerprint, risk_score,
                       risk_level, action_taken, shield_signals, latency_ms, created_at,
                       status, explanation
                FROM transactions {where}
                ORDER BY created_at DESC LIMIT ?""",
            params + [limit],
        )
        rows = [row_to_dict(r) for r in cur.fetchall()]
    for r in rows:
        r["signals"] = loads(r.pop("shield_signals"), [])

    # Raw numbers alongside the human-readable summary, which the app caches and
    # scores against when the API is unreachable.
    from agents.copilot.baseline import get_user_baseline

    b = get_user_baseline(user_id)
    scoring_baseline = None
    if b:
        scoring_baseline = {
            "avg_amount": b["avg_amount"],
            "typical_hours": b["typical_hours"],
            "known_recipients": sorted(b["known_recipients"]),
            "transaction_count": b["transaction_count"],
            "tenure_discount": b.get("tenure_discount", 0.0),
        }

    return {
        "user_id": user_id,
        "balance": {**ledger.get_balance(user_id, institution), "limits": ledger.limits()},
        "transactions": rows,
        "baseline": get_transparency_data(user_id).get("what_we_know", {}),
        "scoring_baseline": scoring_baseline,
    }
