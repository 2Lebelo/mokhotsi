"""Login sessions (one per device sign-in). They back refresh tokens and make revocation instant.

Expired sessions are removed by a TTL index on `expires_at`.
"""

from datetime import datetime
from uuid import UUID

from pymongo import ASCENDING, DESCENDING, IndexModel

from app.core.clock import utcnow
from app.core.db import Database, Document, Session
from app.core.pagination import PageQuery

COLLECTION = "sessions"
INDEXES = [
    IndexModel(
        [("user_id", ASCENDING), ("created_at", DESCENDING), ("_id", DESCENDING)],
        name="user_created_at",
    ),
    IndexModel([("expires_at", ASCENDING)], name="expires_at_ttl", expireAfterSeconds=0),
]


def new_session_doc(
    *,
    session_id: UUID,
    user_id: UUID,
    device_id: UUID | None,
    refresh_hash: str,
    expires_at: datetime,
    ip: str,
    user_agent: str | None,
) -> Document:
    now = utcnow()
    return {
        "_id": session_id,
        "user_id": user_id,
        "device_id": device_id,
        "refresh_hash": refresh_hash,
        "rotations": 0,
        "created_at": now,
        "last_used_at": now,
        "expires_at": expires_at,
        "revoked_at": None,
        "revoked_reason": None,
        "ip": ip,
        "user_agent": user_agent,
    }


async def insert(db: Database, doc: Document) -> None:
    await db[COLLECTION].insert_one(doc)


async def get(db: Database, session_id: UUID) -> Document | None:
    return await db[COLLECTION].find_one({"_id": session_id})


async def rotate(
    db: Database,
    session_id: UUID,
    old_hash: str,
    new_hash: str,
    ip: str,
    expires_at: datetime,
) -> bool:
    """Swap the refresh secret only if `old_hash` is still current (atomic: one winner).

    Sliding expiry: a device that keeps refreshing stays signed in.
    """
    result = await db[COLLECTION].update_one(
        {"_id": session_id, "refresh_hash": old_hash, "revoked_at": None},
        {
            "$set": {
                "refresh_hash": new_hash,
                "last_used_at": utcnow(),
                "ip": ip,
                "expires_at": expires_at,
            },
            "$inc": {"rotations": 1},
        },
    )
    return result.modified_count == 1


async def revoke(db: Database, session_id: UUID, reason: str) -> bool:
    result = await db[COLLECTION].update_one(
        {"_id": session_id, "revoked_at": None},
        {"$set": {"revoked_at": utcnow(), "revoked_reason": reason}},
    )
    return result.modified_count == 1


async def revoke_all_for_user(
    db: Database,
    user_id: UUID,
    reason: str,
    *,
    except_session: UUID | None = None,
    session: Session | None = None,
) -> int:
    query: Document = {"user_id": user_id, "revoked_at": None}
    if except_session is not None:
        query["_id"] = {"$ne": except_session}
    result = await db[COLLECTION].update_many(
        query, {"$set": {"revoked_at": utcnow(), "revoked_reason": reason}}, session=session
    )
    return result.modified_count


async def list_page(db: Database, query: PageQuery) -> list[Document]:
    cursor = db[COLLECTION].find(query.filter).sort(query.sort).limit(query.limit + 1)
    return await cursor.to_list()
