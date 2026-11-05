"""Images a shop stored in Cloudinary (product photos and correction crops), by content hash.
The bytes live in Cloudinary under `shops/<shop_id>/<sha256>`; this is the index of them."""

from uuid import UUID

from pymongo import ASCENDING, IndexModel

from app.core.db import Database, Document

COLLECTION = "photos"
INDEXES = [
    IndexModel([("shop_id", ASCENDING), ("sha256", ASCENDING)], name="shop_sha256", unique=True)
]


async def find(db: Database, shop_id: UUID, hashes: list[str]) -> dict[str, Document]:
    cursor = db[COLLECTION].find({"shop_id": shop_id, "sha256": {"$in": hashes}})
    return {doc["sha256"]: doc async for doc in cursor}


async def save(db: Database, doc: Document) -> None:
    """Idempotent: an image confirmed twice (a retried request) is stored once."""
    await db[COLLECTION].update_one(
        {"shop_id": doc["shop_id"], "sha256": doc["sha256"]},
        {"$setOnInsert": doc},
        upsert=True,
    )
