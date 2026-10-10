"""Idempotency ledger for pushed ops: `_id` = op_id, expires 30 days after `applied_at`."""

from uuid import UUID

from pymongo import ASCENDING, IndexModel

from app.core.clock import utcnow
from app.core.db import Database, Session

COLLECTION = "applied_ops"
TTL_SECONDS = 30 * 24 * 60 * 60
INDEXES = [
    IndexModel([("applied_at", ASCENDING)], name="applied_at_ttl", expireAfterSeconds=TTL_SECONDS)
]


async def owners(
    db: Database, op_ids: list[UUID], session: Session | None = None
) -> dict[UUID, UUID]:
    """{op_id: shop_id} for the op_ids already applied (by any shop)."""
    if not op_ids:
        return {}
    cursor = db[COLLECTION].find(
        {"_id": {"$in": op_ids}}, projection={"shop_id": 1}, session=session
    )
    return {doc["_id"]: doc["shop_id"] async for doc in cursor}


async def record(
    db: Database, shop_id: UUID, op_ids: list[UUID], session: Session | None = None
) -> None:
    """Call in the same transaction as the writes, after checking `owners` in that transaction."""
    if not op_ids:
        return
    now = utcnow()
    await db[COLLECTION].insert_many(
        [{"_id": op_id, "shop_id": shop_id, "applied_at": now} for op_id in op_ids],
        session=session,
    )
