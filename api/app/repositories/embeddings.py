from datetime import datetime
from uuid import UUID

from pymongo import ASCENDING, IndexModel

from app.core.db import Database, Document, Session
from app.repositories import _sync_common

COLLECTION = "embeddings"
INDEXES = [
    IndexModel([("shop_id", ASCENDING), ("seq", ASCENDING)], name="shop_seq", unique=True),
    IndexModel([("shop_id", ASCENDING), ("product_id", ASCENDING)], name="shop_product"),
]


async def insert(
    db: Database, shop_id: UUID, doc: Document, seq: int, session: Session | None = None
) -> None:
    """Embeddings are insert-only. `vector` is BSON binary (little-endian float32)."""
    await db[COLLECTION].insert_one({**doc, "shop_id": shop_id, "seq": seq}, session=session)


async def soft_delete(
    db: Database,
    shop_id: UUID,
    embedding_id: UUID,
    seq: int,
    deleted_at: datetime,
    session: Session | None = None,
) -> None:
    await db[COLLECTION].update_one(
        {"_id": embedding_id, "shop_id": shop_id},
        {"$set": {"deleted": True, "deleted_at": deleted_at, "seq": seq}},
        session=session,
    )


async def get(
    db: Database, shop_id: UUID, embedding_id: UUID, session: Session | None = None
) -> Document | None:
    return await db[COLLECTION].find_one({"_id": embedding_id, "shop_id": shop_id}, session=session)


async def live_ids_for_product(
    db: Database, shop_id: UUID, product_id: UUID, session: Session | None = None
) -> list[UUID]:
    cursor = db[COLLECTION].find(
        {"shop_id": shop_id, "product_id": product_id, "deleted": False},
        projection={"_id": 1},
        session=session,
    )
    return [doc["_id"] async for doc in cursor]


async def owners(db: Database, ids: list[UUID], session: Session | None = None) -> dict[UUID, UUID]:
    return await _sync_common.owners(db, COLLECTION, ids, session)


async def changes_since(db: Database, shop_id: UUID, after_seq: int, limit: int) -> list[Document]:
    return await _sync_common.changes_since(db, COLLECTION, shop_id, after_seq, limit)
