"""People removed from a shop: `{_id: "<shop>:<user>", shop_id, user_id, role, removed_at}`.

A till that was offline when a cashier was removed still syncs their sales. This tells a former
member (kept, flagged for the owner) from someone who never worked there (refused).
"""

from uuid import UUID

from pymongo import IndexModel

from app.core.clock import utcnow
from app.core.db import Database, Session

COLLECTION = "member_history"
INDEXES: list[IndexModel] = []


def _key(shop_id: UUID, user_id: UUID) -> str:
    return f"{shop_id}:{user_id}"


async def record_removal(
    db: Database, shop_id: UUID, user_id: UUID, role: str, session: Session | None = None
) -> None:
    await db[COLLECTION].update_one(
        {"_id": _key(shop_id, user_id)},
        {
            "$set": {"removed_at": utcnow(), "role": role},
            "$setOnInsert": {"shop_id": shop_id, "user_id": user_id},
        },
        upsert=True,
        session=session,
    )


async def former(
    db: Database, shop_id: UUID, user_ids: list[UUID], session: Session | None = None
) -> set[UUID]:
    if not user_ids:
        return set()
    cursor = db[COLLECTION].find(
        {"_id": {"$in": [_key(shop_id, u) for u in user_ids]}},
        projection={"user_id": 1},
        session=session,
    )
    return {doc["user_id"] async for doc in cursor}
