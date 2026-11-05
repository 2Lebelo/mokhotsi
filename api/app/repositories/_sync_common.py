"""Queries shared by the synced collections (products, sales, reversals, stock movements,
embeddings, stock levels). Every synced document carries `shop_id`; what changed and in which
order is recorded separately in `changes` (see changes.py).
"""

from typing import Any
from uuid import UUID

from app.core.db import Database, Document, Session


async def owners(
    db: Database, collection: str, ids: list[UUID], session: Session | None = None
) -> dict[UUID, UUID]:
    """{id: shop_id} for the ids that exist in any shop (used to refuse cross-shop ids)."""
    if not ids:
        return {}
    cursor = db[collection].find({"_id": {"$in": ids}}, projection={"shop_id": 1}, session=session)
    return {doc["_id"]: doc["shop_id"] async for doc in cursor}


async def find_many(
    db: Database,
    collection: str,
    shop_id: UUID,
    ids: list[Any],
    session: Session | None = None,
) -> dict[Any, Document]:
    """{id: document} for the ids this shop has."""
    if not ids:
        return {}
    cursor = db[collection].find({"shop_id": shop_id, "_id": {"$in": ids}}, session=session)
    return {doc["_id"]: doc async for doc in cursor}


async def insert_many(
    db: Database, collection: str, docs: list[Document], session: Session | None = None
) -> None:
    if docs:
        await db[collection].insert_many(docs, ordered=False, session=session)


async def page_by_id(
    db: Database,
    collection: str,
    query: Document,
    after: Any | None,
    limit: int,
    session: Session | None = None,
) -> list[Document]:
    """Keyset page in `_id` order (`after` = the last `_id` of the previous page)."""
    if after is not None:
        query = {**query, "_id": {"$gt": after}}
    cursor = db[collection].find(query, session=session).sort("_id", 1).limit(limit)
    return [doc async for doc in cursor]


async def page_by_time(
    db: Database,
    collection: str,
    query: Document,
    after: tuple[Any, UUID] | None,
    limit: int,
    session: Session | None = None,
) -> list[Document]:
    """Keyset page in (`created_at`, `_id`) order (`after` = that pair from the previous page)."""
    if after is not None:
        created_at, last_id = after
        query = {
            **query,
            "$or": [
                {"created_at": {"$gt": created_at}},
                {"created_at": created_at, "_id": {"$gt": last_id}},
            ],
        }
    cursor = (
        db[collection]
        .find(query, session=session)
        .sort([("created_at", 1), ("_id", 1)])
        .limit(limit)
    )
    return [doc async for doc in cursor]
