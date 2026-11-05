"""The shop's change feed: `{shop_id, seq, entity, entity_id, at}`, one entry per record changed.

Pull reads it in seq order and fetches each record's current state. Seqs are reserved at the
very end of a push transaction (see sync_push), so seq order is commit order and a shop's feed
has no gaps; a gap at the start of a pull means that history was pruned (180-day TTL) and the
device must take a fresh snapshot.
"""

from datetime import datetime
from uuid import UUID

from pymongo import ASCENDING, IndexModel

from app.core.db import Database, Document, Session

COLLECTION = "changes"
RETENTION_SECONDS = 180 * 24 * 60 * 60
INDEXES = [
    IndexModel([("shop_id", ASCENDING), ("seq", ASCENDING)], name="shop_seq", unique=True),
    IndexModel([("at", ASCENDING)], name="at_ttl", expireAfterSeconds=RETENTION_SECONDS),
]


async def append(
    db: Database,
    shop_id: UUID,
    first_seq: int,
    entries: list[tuple[str, UUID]],
    at: datetime,
    session: Session | None = None,
) -> None:
    if entries:
        await db[COLLECTION].insert_many(
            [
                {
                    "shop_id": shop_id,
                    "seq": first_seq + n,
                    "entity": entity,
                    "entity_id": eid,
                    "at": at,
                }
                for n, (entity, eid) in enumerate(entries)
            ],
            session=session,
        )


async def window(
    db: Database, shop_id: UUID, after: int, upto: int, limit: int, session: Session | None = None
) -> list[Document]:
    """Entries with `after < seq <= upto`, oldest first."""
    cursor = (
        db[COLLECTION]
        .find({"shop_id": shop_id, "seq": {"$gt": after, "$lte": upto}}, session=session)
        .sort("seq", 1)
        .limit(limit)
    )
    return [doc async for doc in cursor]
