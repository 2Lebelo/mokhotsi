"""Each shop's PIN key: HMAC key for the members' PIN tags (ADR 0005).

Kept apart from `shops` so that no shop query or response can ever include it. It reaches a
phone only through the roster of a device registered to the shop.
"""

from uuid import UUID

from bson import Binary

from app.core.clock import utcnow
from app.core.db import Database, Session

COLLECTION = "shop_secrets"
INDEXES: list = []  # Looked up by _id (the shop id) only.


async def insert(db: Database, shop_id: UUID, pin_key: bytes, session: Session) -> None:
    await db[COLLECTION].insert_one(
        {"_id": shop_id, "pin_key": Binary(pin_key), "created_at": utcnow()}, session=session
    )


async def get_keys(
    db: Database, shop_ids: list[UUID], session: Session | None = None
) -> dict[UUID, bytes]:
    cursor = db[COLLECTION].find({"_id": {"$in": shop_ids}}, session=session)
    return {d["_id"]: bytes(d["pin_key"]) async for d in cursor}


async def get_key(db: Database, shop_id: UUID, session: Session | None = None) -> bytes | None:
    return (await get_keys(db, [shop_id], session)).get(shop_id)
