"""Queries shared by the three synced collections (products, embeddings, sales).

Every synced document carries `shop_id` and a per-shop `seq` (unique index `shop_seq`).
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


async def changes_since(
    db: Database,
    collection: str,
    shop_id: UUID,
    after_seq: int,
    limit: int,
    extra: dict[str, Any] | None = None,
) -> list[Document]:
    """Documents with seq > after_seq, oldest first (uses a `(shop_id, …, seq)` index)."""
    query: Document = {"shop_id": shop_id, **(extra or {}), "seq": {"$gt": after_seq}}
    cursor = db[collection].find(query).sort("seq", 1).limit(limit)
    return [doc async for doc in cursor]
