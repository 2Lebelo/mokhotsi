"""Cash sales as the till recorded them (insert-only facts, sync v2)."""

from uuid import UUID

from pymongo import ASCENDING, IndexModel

from app.core.db import Database, Document, Session

COLLECTION = "sales"
INDEXES = [
    # Snapshot pages (last 90 days) and reports.
    IndexModel(
        [("shop_id", ASCENDING), ("created_at", ASCENDING), ("_id", ASCENDING)],
        name="shop_created_at_id",
    ),
]


async def items(
    db: Database, shop_id: UUID, sale_ids: list[UUID], session: Session | None = None
) -> dict[UUID, list[Document]]:
    """{sale_id: items} for the sales this shop has (reversals refer to their lines)."""
    if not sale_ids:
        return {}
    cursor = db[COLLECTION].find(
        {"shop_id": shop_id, "_id": {"$in": sale_ids}},
        projection={"items.id": 1, "items.variant_id": 1, "items.quantity": 1},
        session=session,
    )
    return {doc["_id"]: doc["items"] async for doc in cursor}
