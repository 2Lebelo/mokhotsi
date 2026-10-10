from uuid import UUID

from pymongo import ASCENDING, IndexModel

from app.core.db import Database, Document, Session
from app.repositories import _sync_common

COLLECTION = "sales"
INDEXES = [
    IndexModel([("shop_id", ASCENDING), ("seq", ASCENDING)], name="shop_seq", unique=True),
    IndexModel([("shop_id", ASCENDING), ("created_at", ASCENDING)], name="shop_created_at"),
    # Pull for callers without sales:read (only their own sales).
    IndexModel(
        [("shop_id", ASCENDING), ("created_by", ASCENDING), ("seq", ASCENDING)],
        name="shop_creator_seq",
    ),
]


async def insert(
    db: Database, shop_id: UUID, doc: Document, seq: int, session: Session | None = None
) -> None:
    """Sales are insert-only; items are embedded."""
    await db[COLLECTION].insert_one({**doc, "shop_id": shop_id, "seq": seq}, session=session)


async def owners(db: Database, ids: list[UUID], session: Session | None = None) -> dict[UUID, UUID]:
    return await _sync_common.owners(db, COLLECTION, ids, session)


async def changes_since(
    db: Database, shop_id: UUID, after_seq: int, limit: int, created_by: UUID | None = None
) -> list[Document]:
    """With `created_by`, only that user's sales."""
    extra = {"created_by": created_by} if created_by is not None else None
    return await _sync_common.changes_since(db, COLLECTION, shop_id, after_seq, limit, extra)
