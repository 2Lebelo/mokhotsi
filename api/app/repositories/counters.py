"""Per-shop sequence counter: `{_id: shop_id, seq: <last assigned>}`.

Keyed by `_id = shop_id`, so the built-in `_id` index is the lookup index (none to create).
One counter per shop is shared by products, embeddings and sales, so a single pull cursor
orders every change for that shop.
"""

from uuid import UUID

from pymongo import IndexModel

from app.core.db import Database
from app.core.errors import NotImplementedFeature

COLLECTION = "counters"
INDEXES: list[IndexModel] = []


async def reserve(db: Database, shop_id: UUID, count: int) -> int:
    """Atomically reserve `count` seqs; returns the first one."""
    # TODO(feature): find_one_and_update({_id: shop_id}, {$inc: {seq: count}}, upsert=True,
    # return_document=AFTER) → doc["seq"] - count + 1.
    raise NotImplementedFeature("counters.reserve")
