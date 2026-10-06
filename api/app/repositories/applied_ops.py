"""Idempotency ledger for pushed ops: `_id` = op_id, expires 30 days after `applied_at`."""

from uuid import UUID

from pymongo import ASCENDING, IndexModel

from app.core.db import Database
from app.core.errors import NotImplementedFeature

COLLECTION = "applied_ops"
TTL_SECONDS = 30 * 24 * 60 * 60
INDEXES = [
    IndexModel([("applied_at", ASCENDING)], name="applied_at_ttl", expireAfterSeconds=TTL_SECONDS)
]


async def already_applied(db: Database, op_ids: list[UUID]) -> set[UUID]:
    # TODO(feature): find({_id: {$in: op_ids}}, projection {_id: 1}) → set of ids.
    raise NotImplementedFeature("applied_ops.already_applied")


async def record(db: Database, shop_id: UUID, op_ids: list[UUID]) -> None:
    # TODO(feature): insert_many([{_id, shop_id, applied_at: now}], ordered=False); ignore duplicate keys.
    raise NotImplementedFeature("applied_ops.record")
