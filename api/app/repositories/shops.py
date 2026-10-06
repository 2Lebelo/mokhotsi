from uuid import UUID

from pymongo import ASCENDING, IndexModel

from app.core.db import Database, Document
from app.core.errors import NotImplementedFeature

COLLECTION = "shops"
INDEXES = [IndexModel([("owner_phone", ASCENDING)], name="owner_phone_unique", unique=True)]


async def insert_shop(
    db: Database, shop_id: UUID, name: str, owner_phone: str, password_hash: str
) -> None:
    # TODO(feature): insert {_id: shop_id, name, owner_phone, password_hash, created_at}; map DuplicateKeyError → 409.
    raise NotImplementedFeature("shops.insert_shop")


async def find_by_owner_phone(db: Database, owner_phone: str) -> Document | None:
    # TODO(feature): find_one({"owner_phone": owner_phone}) (uses owner_phone_unique).
    raise NotImplementedFeature("shops.find_by_owner_phone")
