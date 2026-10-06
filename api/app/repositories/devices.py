from uuid import UUID

from pymongo import ASCENDING, IndexModel

from app.core.db import Database, Document
from app.core.errors import NotImplementedFeature

COLLECTION = "devices"
INDEXES = [IndexModel([("shop_id", ASCENDING)], name="shop_id")]


async def upsert_device(db: Database, device_id: UUID, shop_id: UUID) -> None:
    # TODO(feature): update_one({_id: device_id}, {$set: {shop_id, last_seen_at}}, upsert=True).
    raise NotImplementedFeature("devices.upsert_device")


async def list_for_shop(db: Database, shop_id: UUID) -> list[Document]:
    # TODO(feature): find({"shop_id": shop_id}) (uses shop_id index).
    raise NotImplementedFeature("devices.list_for_shop")
