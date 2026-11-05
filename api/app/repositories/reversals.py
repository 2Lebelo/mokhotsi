"""Refunds of whole sales or some of their lines (insert-only facts, sync v2)."""

from uuid import UUID

from pymongo import ASCENDING, IndexModel

from app.core.db import Database, Session

COLLECTION = "reversals"
INDEXES = [
    IndexModel(
        [("shop_id", ASCENDING), ("created_at", ASCENDING), ("_id", ASCENDING)],
        name="shop_created_at_id",
    ),
    IndexModel([("shop_id", ASCENDING), ("sale_id", ASCENDING)], name="shop_sale"),
]


async def reversed_quantities(
    db: Database, shop_id: UUID, sale_ids: list[UUID], session: Session | None = None
) -> dict[UUID, int]:
    """{sale_item_id: units already reversed} over the given sales."""
    if not sale_ids:
        return {}
    cursor = db[COLLECTION].find(
        {"shop_id": shop_id, "sale_id": {"$in": sale_ids}},
        projection={"items.sale_item_id": 1, "items.quantity": 1},
        session=session,
    )
    totals: dict[UUID, int] = {}
    async for doc in cursor:
        for item in doc["items"]:
            totals[item["sale_item_id"]] = totals.get(item["sale_item_id"], 0) + item["quantity"]
    return totals
