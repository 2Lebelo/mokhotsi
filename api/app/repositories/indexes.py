"""Creates every index at startup. `create_indexes` is idempotent for unchanged definitions."""

import logging

from pymongo import IndexModel

from app.core.db import Database
from app.repositories import (
    applied_ops,
    counters,
    devices,
    embeddings,
    products,
    sales,
    shops,
)

log = logging.getLogger("app.indexes")

ALL_INDEXES: dict[str, list[IndexModel]] = {
    m.COLLECTION: m.INDEXES
    for m in (shops, devices, products, embeddings, sales, applied_ops, counters)
}


async def ensure_indexes(db: Database) -> None:
    for collection, indexes in ALL_INDEXES.items():
        if not indexes:
            continue
        names = await db[collection].create_indexes(indexes)
        log.info("indexes ensured", extra={"collection": collection, "indexes": names})
