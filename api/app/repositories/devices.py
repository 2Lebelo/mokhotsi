"""Registered phones (ADR 0005). A phone proves itself with a long random secret it got once at
registration (only sha256 of it is stored), so it can sync with nobody signed in, and a PIN
is only accepted together with a registered phone.

`shop_ids` are the shops whose roster and data the phone may hold. `version` goes up when that
list changes or the phone is revoked, so it is part of the roster's ETag.
"""

from datetime import timedelta
from uuid import UUID, uuid4

from pymongo import ASCENDING, DESCENDING, IndexModel, ReturnDocument

from app.core.clock import utcnow
from app.core.db import Database, Document, Session
from app.core.pagination import PageQuery

COLLECTION = "devices"
INDEXES = [
    # A shop's phones, newest first (multikey on shop_ids).
    IndexModel(
        [("shop_ids", ASCENDING), ("created_at", DESCENDING), ("_id", DESCENDING)],
        name="shop_ids_created_at",
    ),
    IndexModel(
        [("registered_by", ASCENDING), ("created_at", DESCENDING), ("_id", DESCENDING)],
        name="registered_by_created_at",
    ),
    IndexModel([("created_at", DESCENDING), ("_id", DESCENDING)], name="created_at"),
]

# Writing last_seen_at on every request would turn each read into a write; minutes are enough.
_SEEN_GRANULARITY = timedelta(minutes=5)


def new_device_doc(*, name: str, platform: str, registered_by: UUID, secret_hash: str) -> Document:
    now = utcnow()
    return {
        "_id": uuid4(),
        "name": name.strip(),
        "platform": platform,
        "registered_by": registered_by,
        "shop_ids": [],
        "secret_hash": secret_hash,
        "created_at": now,
        "last_seen_at": now,
        "last_sync_at": None,
        "revoked_at": None,
        "revoked_by": None,
        "version": 1,
    }


async def insert(db: Database, doc: Document, session: Session | None = None) -> None:
    await db[COLLECTION].insert_one(doc, session=session)


async def get(db: Database, device_id: UUID, session: Session | None = None) -> Document | None:
    return await db[COLLECTION].find_one({"_id": device_id}, session=session)


async def get_many(
    db: Database, device_ids: list[UUID], session: Session | None = None
) -> dict[UUID, Document]:
    cursor = db[COLLECTION].find({"_id": {"$in": device_ids}}, session=session)
    return {d["_id"]: d async for d in cursor}


async def link_shop(
    db: Database, device_id: UUID, shop_id: UUID, session: Session | None = None
) -> Document | None:
    """Add the shop to an active device (no-op if already there). None if missing or revoked."""
    return await db[COLLECTION].find_one_and_update(
        {"_id": device_id, "revoked_at": None},
        [
            {
                "$set": {
                    "version": {
                        "$add": [
                            "$version",
                            {"$cond": [{"$in": [shop_id, "$shop_ids"]}, 0, 1]},
                        ]
                    },
                    "shop_ids": {"$setUnion": ["$shop_ids", [shop_id]]},
                }
            }
        ],
        return_document=ReturnDocument.AFTER,
        session=session,
    )


async def unlink_shop(
    db: Database, device_id: UUID, shop_id: UUID, session: Session | None = None
) -> bool:
    result = await db[COLLECTION].update_one(
        {"_id": device_id, "shop_ids": shop_id},
        {"$pull": {"shop_ids": shop_id}, "$inc": {"version": 1}},
        session=session,
    )
    return result.modified_count == 1


async def revoke(
    db: Database, device_id: UUID, revoked_by: UUID | None, session: Session | None = None
) -> bool:
    result = await db[COLLECTION].update_one(
        {"_id": device_id, "revoked_at": None},
        {"$set": {"revoked_at": utcnow(), "revoked_by": revoked_by}, "$inc": {"version": 1}},
        session=session,
    )
    return result.modified_count == 1


async def touch_seen(db: Database, device_id: UUID) -> None:
    now = utcnow()
    await db[COLLECTION].update_one(
        {"_id": device_id, "last_seen_at": {"$lt": now - _SEEN_GRANULARITY}},
        {"$set": {"last_seen_at": now}},
    )


async def touch_sync(
    db: Database, device_id: UUID, shop_id: UUID, session: Session | None = None
) -> None:
    """Record a sync by a registered phone of this shop. Unknown ids are ignored, never added."""
    now = utcnow()
    await db[COLLECTION].update_one(
        {"_id": device_id, "shop_ids": shop_id, "revoked_at": None},
        {"$set": {"last_sync_at": now, "last_seen_at": now}},
        session=session,
    )


async def list_page(db: Database, query: PageQuery) -> list[Document]:
    cursor = db[COLLECTION].find(query.filter).sort(query.sort).limit(query.limit + 1)
    return await cursor.to_list()
