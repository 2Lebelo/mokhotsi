from uuid import UUID

from pymongo import ASCENDING, IndexModel

from app.core.db import Database, Document
from app.core.errors import NotImplementedFeature

COLLECTION = "embeddings"
INDEXES = [IndexModel([("shop_id", ASCENDING), ("seq", ASCENDING)], name="shop_seq", unique=True)]


async def upsert(db: Database, shop_id: UUID, record: Document, seq: int) -> None:
    # TODO(feature): replace_one({_id, shop_id}, {...record, shop_id, seq}, upsert=True); store vector as BSON binary.
    raise NotImplementedFeature("embeddings.upsert")


async def changes_since(db: Database, shop_id: UUID, after_seq: int, limit: int) -> list[Document]:
    # TODO(feature): find({shop_id, seq: {$gt: after_seq}}).sort("seq", 1).limit(limit) (uses shop_seq).
    raise NotImplementedFeature("embeddings.changes_since")
