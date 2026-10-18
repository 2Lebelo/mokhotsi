from uuid import UUID

from pymongo import ASCENDING, IndexModel

from app.core.clock import utcnow
from app.core.db import Database, Document, Session

COLLECTION = "devices"
INDEXES = [IndexModel([("shop_id", ASCENDING)], name="shop_id")]


async def upsert_device(
    db: Database, device_id: UUID, shop_id: UUID, user_id: UUID, session: Session | None = None
) -> None:
    """Remember which shop and user a device last synced as."""
    now = utcnow()
    await db[COLLECTION].update_one(
        {"_id": device_id},
        {
            "$set": {"shop_id": shop_id, "user_id": user_id, "last_seen_at": now},
            "$setOnInsert": {"first_seen_at": now},
        },
        upsert=True,
        session=session,
    )


async def list_for_shop(db: Database, shop_id: UUID) -> list[Document]:
    return [doc async for doc in db[COLLECTION].find({"shop_id": shop_id})]
