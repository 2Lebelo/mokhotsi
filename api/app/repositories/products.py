from uuid import UUID

from pymongo import ASCENDING, IndexModel

from app.core.db import Database, Document, Session
from app.repositories import _sync_common

COLLECTION = "products"
INDEXES = [
    IndexModel([("shop_id", ASCENDING), ("seq", ASCENDING)], name="shop_seq", unique=True),
    IndexModel([("shop_id", ASCENDING), ("barcode", ASCENDING)], name="shop_barcode"),
]


async def upsert(
    db: Database, shop_id: UUID, doc: Document, seq: int, session: Session | None = None
) -> None:
    """Replace the whole product: the last write to reach the server wins."""
    await db[COLLECTION].replace_one(
        {"_id": doc["_id"], "shop_id": shop_id},
        {**doc, "shop_id": shop_id, "seq": seq},
        upsert=True,
        session=session,
    )


async def get(
    db: Database, shop_id: UUID, product_id: UUID, session: Session | None = None
) -> Document | None:
    return await db[COLLECTION].find_one({"_id": product_id, "shop_id": shop_id}, session=session)


async def owners(db: Database, ids: list[UUID], session: Session | None = None) -> dict[UUID, UUID]:
    return await _sync_common.owners(db, COLLECTION, ids, session)


async def changes_since(db: Database, shop_id: UUID, after_seq: int, limit: int) -> list[Document]:
    return await _sync_common.changes_since(db, COLLECTION, shop_id, after_seq, limit)
