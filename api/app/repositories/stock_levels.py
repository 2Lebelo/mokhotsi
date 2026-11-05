"""The server's stock per size: `{_id: variant_id, shop_id, stock}`, the sum of every accepted
movement. It may go negative (two tills sold the last unit); devices show what it says."""

from uuid import UUID

from pymongo import ASCENDING, IndexModel, UpdateOne

from app.core.db import Database, Session

COLLECTION = "stock_levels"
INDEXES = [IndexModel([("shop_id", ASCENDING), ("_id", ASCENDING)], name="shop_id_id")]


async def add(
    db: Database, shop_id: UUID, deltas: dict[UUID, int], session: Session | None = None
) -> None:
    updates = [
        UpdateOne({"_id": variant_id, "shop_id": shop_id}, {"$inc": {"stock": delta}}, upsert=True)
        for variant_id, delta in deltas.items()
        if delta != 0
    ]
    if updates:
        await db[COLLECTION].bulk_write(updates, ordered=False, session=session)
