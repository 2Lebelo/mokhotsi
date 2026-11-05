"""Per-shop sequence counter: `{_id: shop_id, seq: <last assigned>}`.

Keyed by `_id = shop_id`, so the built-in `_id` index is the lookup index (none to create).
One counter per shop numbers every entry of its change feed (changes.py), so a single pull
cursor orders every change for that shop.
"""

from uuid import UUID

from pymongo import IndexModel, ReturnDocument

from app.core.db import Database, Session

COLLECTION = "counters"
INDEXES: list[IndexModel] = []


async def reserve(
    db: Database, shop_id: UUID, count: int = 1, session: Session | None = None
) -> int:
    """Atomically reserve `count` seqs; returns the first one."""
    doc = await db[COLLECTION].find_one_and_update(
        {"_id": shop_id},
        {"$inc": {"seq": count}},
        upsert=True,
        return_document=ReturnDocument.AFTER,
        session=session,
    )
    assert doc is not None  # noqa: S101 — upsert with AFTER always returns the document
    return int(doc["seq"]) - count + 1


async def current(db: Database, shop_id: UUID, session: Session | None = None) -> int:
    """The last seq assigned in this shop (0 before its first change)."""
    doc = await db[COLLECTION].find_one({"_id": shop_id}, session=session)
    return int(doc["seq"]) if doc else 0
