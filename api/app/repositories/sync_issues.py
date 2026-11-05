"""What phones could not sync as asked (refused, flagged or clashing changes), for the system admin.

A phone reports each issue once, under the id it gave it, so a report sent twice is stored once.
An issue stays open until the admin resolves it; resolved issues expire after 180 days.
"""

from datetime import datetime, timedelta
from uuid import UUID

from pymongo import ASCENDING, DESCENDING, IndexModel, UpdateOne

from app.core.db import Database, Document, Session
from app.core.pagination import PageQuery

COLLECTION = "sync_issues"
RESOLVED_TTL = timedelta(days=180)
INDEXES = [
    # The admin's list: open (or resolved) issues, newest first.
    IndexModel(
        [("resolved_at", ASCENDING), ("received_at", DESCENDING), ("_id", DESCENDING)],
        name="resolved_received_at",
    ),
    IndexModel([("shop_id", ASCENDING), ("received_at", DESCENDING)], name="shop_received_at"),
    IndexModel(
        [("resolved_at", ASCENDING)],
        name="resolved_at_ttl",
        expireAfterSeconds=int(RESOLVED_TTL.total_seconds()),
        partialFilterExpression={"resolved_at": {"$type": "date"}},
    ),
]


async def insert_new(db: Database, docs: list[Document]) -> None:
    """Stores each issue unless its id is already stored (a report sent again)."""
    if not docs:
        return
    await db[COLLECTION].bulk_write(
        [UpdateOne({"_id": doc["_id"]}, {"$setOnInsert": doc}, upsert=True) for doc in docs],
        ordered=False,
    )


async def list_page(db: Database, query: PageQuery) -> list[Document]:
    cursor = db[COLLECTION].find(query.filter).sort(query.sort).limit(query.limit + 1)
    return await cursor.to_list()


async def count_open(db: Database) -> int:
    return await db[COLLECTION].count_documents({"resolved_at": None})


async def get(db: Database, issue_id: UUID, session: Session | None = None) -> Document | None:
    return await db[COLLECTION].find_one({"_id": issue_id}, session=session)


async def resolve(
    db: Database, issue_id: UUID, by: UUID, at: datetime, session: Session | None = None
) -> bool:
    """Marks an open issue resolved. False if it was already resolved."""
    result = await db[COLLECTION].update_one(
        {"_id": issue_id, "resolved_at": None},
        {"$set": {"resolved_at": at, "resolved_by": by}},
        session=session,
    )
    return result.modified_count == 1
