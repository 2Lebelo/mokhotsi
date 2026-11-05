"""Creates every index at startup. `create_indexes` is idempotent for unchanged definitions."""

import logging

from pymongo import IndexModel
from pymongo.errors import OperationFailure

from app.core.db import Database
from app.repositories import (
    applied_ops,
    audit_logs,
    changes,
    counters,
    devices,
    embeddings,
    idempotency_keys,
    member_history,
    memberships,
    migrations,
    photos,
    products,
    reversals,
    roles,
    sales,
    sessions,
    shop_secrets,
    shops,
    stock_levels,
    stock_movements,
    sync_issues,
    users,
)

log = logging.getLogger("app.indexes")

ALL_INDEXES: dict[str, list[IndexModel]] = {
    m.COLLECTION: m.INDEXES
    for m in (
        users,
        roles,
        shops,
        shop_secrets,
        memberships,
        sessions,
        audit_logs,
        idempotency_keys,
        devices,
        member_history,
        products,
        sales,
        reversals,
        stock_movements,
        stock_levels,
        embeddings,
        photos,
        changes,
        applied_ops,
        counters,
        migrations,
        sync_issues,
    )
}

# Indexes from earlier schemas that would now be wrong (dropped if present).
LEGACY_INDEXES: dict[str, list[str]] = {
    # Unique on a field new shops no longer have: every second shop would collide on null.
    "shops": ["owner_phone_unique"],
    # Email sign-in is gone (everyone uses a PIN); role_created_at became role_status_created_at.
    "users": ["email_unique", "email_unique_when_set", "role_created_at"],
    # Filtered on the old "sitter" role name; replaced by cashier_one_shop.
    "memberships": ["sitter_one_shop"],
    # The v1 tracker keyed devices by one shop; the registry keys them by many (shop_ids).
    "devices": ["shop_id"],
    # Sync v1 numbered documents with a per-shop `seq`; v2 records order in `changes`. A unique
    # (shop_id, seq) index would collide on every v2 document (they have no seq).
    "products": ["shop_seq", "shop_barcode"],
    "sales": ["shop_seq", "shop_created_at", "shop_creator_seq"],
    "embeddings": ["shop_seq"],
    # The 30-day ledger became 180 days (a TTL change needs a new index).
    "applied_ops": ["applied_at_ttl"],
}


async def drop_legacy_indexes(db: Database) -> None:
    for collection, names in LEGACY_INDEXES.items():
        for name in names:
            try:
                await db[collection].drop_index(name)
                log.info("legacy index dropped", extra={"collection": collection, "index": name})
            except OperationFailure:
                pass  # Not there: nothing to do.


async def create_indexes(db: Database) -> None:
    for collection, indexes in ALL_INDEXES.items():
        if not indexes:
            continue
        names = await db[collection].create_indexes(indexes)
        log.info("indexes ensured", extra={"collection": collection, "indexes": names})
