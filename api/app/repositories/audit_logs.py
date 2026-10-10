"""Append-only audit trail. Never updated or deleted by the application."""

from pymongo import ASCENDING, DESCENDING, IndexModel

from app.core.db import Database, Document, Session
from app.core.pagination import PageQuery

COLLECTION = "audit_logs"
INDEXES = [
    IndexModel([("created_at", DESCENDING), ("_id", DESCENDING)], name="created_at"),
    IndexModel(
        [("shop_id", ASCENDING), ("created_at", DESCENDING), ("_id", DESCENDING)],
        name="shop_created_at",
    ),
    IndexModel(
        [("actor_id", ASCENDING), ("created_at", DESCENDING), ("_id", DESCENDING)],
        name="actor_created_at",
    ),
    IndexModel(
        [("action", ASCENDING), ("created_at", DESCENDING), ("_id", DESCENDING)],
        name="action_created_at",
    ),
    IndexModel(
        [("entity", ASCENDING), ("entity_id", ASCENDING), ("created_at", DESCENDING)],
        name="entity_created_at",
    ),
]


async def insert(db: Database, doc: Document, session: Session | None = None) -> None:
    await db[COLLECTION].insert_one(doc, session=session)


async def list_page(db: Database, query: PageQuery) -> list[Document]:
    cursor = db[COLLECTION].find(query.filter).sort(query.sort).limit(query.limit + 1)
    return await cursor.to_list()
