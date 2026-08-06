"""Customer notification feed.

Deliberately reads a table of things the customer was actually told, rather
than deriving a feed from transaction history. The distinction matters: seeded
history exists to give the console's charts something to draw, and nobody was
ever notified about any of it. Presenting 90 days of backfill as "your
notifications" tells the customer about alerts they never received.

So this feed is empty on a fresh install, and fills as decisions are made.
That is the honest behaviour.
"""
from fastapi import APIRouter

import notifications as notify

router = APIRouter(prefix="/v1/notifications", tags=["notifications"])


@router.get("/{user_id}")
def list_for_user(user_id: str, limit: int = 30):
    items = notify.for_user(user_id, limit)
    return {
        "user_id": user_id,
        "unread": sum(1 for n in items if not n.get("read_at")),
        "notifications": items,
    }


@router.post("/{user_id}/read")
def mark_read(user_id: str):
    return {"user_id": user_id, "marked_read": notify.mark_read(user_id)}
