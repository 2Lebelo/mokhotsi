"""Stored product views for visual matching (sync v2): float16 vectors tagged with the model
that made them. Insert-only. A deleted view keeps a tombstone (`deleted_at`) for 200 days, so a
late re-send can never bring it back; then the TTL index removes it."""

from datetime import datetime
from uuid import UUID

from pymongo import ASCENDING, IndexModel

from app.core.db import Database, Session

COLLECTION = "embeddings"
TOMBSTONE_SECONDS = 200 * 24 * 60 * 60
INDEXES = [
    IndexModel(
        [("shop_id", ASCENDING), ("model_version", ASCENDING), ("_id", ASCENDING)],
        name="shop_model_id",
    ),
    IndexModel([("shop_id", ASCENDING), ("product_id", ASCENDING)], name="shop_product"),
    IndexModel(
        [("deleted_at", ASCENDING)],
        name="deleted_at_ttl",
        expireAfterSeconds=TOMBSTONE_SECONDS,
        partialFilterExpression={"deleted_at": {"$type": "date"}},
    ),
]


async def delete(
    db: Database, shop_id: UUID, ids: list[UUID], at: datetime, session: Session | None = None
) -> None:
    if ids:
        await db[COLLECTION].update_many(
            {"shop_id": shop_id, "_id": {"$in": ids}, "deleted_at": None},
            {"$set": {"deleted_at": at}},
            session=session,
        )
