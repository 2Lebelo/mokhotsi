"""Creates every index at startup. `create_indexes` is idempotent for unchanged definitions."""

import logging

from pymongo import IndexModel
from pymongo.errors import OperationFailure

from app.core.db import Database
from app.repositories import (
    applied_ops,
    audit_logs,
    counters,
    devices,
    embeddings,
    idempotency_keys,
    memberships,
    products,
    sales,
    sessions,
    shops,
    users,
)

log = logging.getLogger("app.indexes")

ALL_INDEXES: dict[str, list[IndexModel]] = {
    m.COLLECTION: m.INDEXES
    for m in (
        users,
        shops,
        memberships,
        sessions,
        audit_logs,
        idempotency_keys,
        devices,
        products,
        embeddings,
        sales,
        applied_ops,
        counters,
    )
}

# Indexes from earlier schemas that would now be wrong (dropped if present).
LEGACY_INDEXES: dict[str, list[str]] = {
    # Unique on a field new shops no longer have: every second shop would collide on null.
    "shops": ["owner_phone_unique"],
}


async def ensure_indexes(db: Database) -> None:
    for collection, names in LEGACY_INDEXES.items():
        for name in names:
            try:
                await db[collection].drop_index(name)
                log.info("legacy index dropped", extra={"collection": collection, "index": name})
            except OperationFailure:
                pass  # Not there: nothing to do.
    for collection, indexes in ALL_INDEXES.items():
        if not indexes:
            continue
        names = await db[collection].create_indexes(indexes)
        log.info("indexes ensured", extra={"collection": collection, "indexes": names})
