"""Users: one document per person. `email` is stored lowercased and is unique."""

from datetime import datetime, timedelta
from typing import Any
from uuid import UUID, uuid4

from pymongo import ASCENDING, DESCENDING, IndexModel, ReturnDocument
from pymongo.errors import DuplicateKeyError

from app.core.clock import utcnow
from app.core.db import Database, Document, Session
from app.core.errors import Conflict
from app.core.pagination import PageQuery
from app.core.permissions import Role
from app.repositories._common import versioned_update

COLLECTION = "users"
INDEXES = [
    IndexModel([("email", ASCENDING)], name="email_unique", unique=True),
    IndexModel([("created_at", DESCENDING), ("_id", DESCENDING)], name="created_at"),
    IndexModel([("role", ASCENDING), ("created_at", DESCENDING)], name="role_created_at"),
]


def new_user_doc(
    *,
    email: str,
    name: str,
    role: Role,
    password_hash: str,
    must_change_password: bool,
    created_by: UUID | None,
) -> Document:
    now = utcnow()
    return {
        "_id": uuid4(),
        "email": email.strip().lower(),
        "name": name.strip(),
        "role": role.value,
        "status": "active",
        "password_hash": password_hash,
        "must_change_password": must_change_password,
        "failed_logins": 0,
        "locked_until": None,
        "last_login_at": None,
        "password_changed_at": now,
        "created_by": created_by,
        "created_at": now,
        "updated_at": now,
        "version": 1,
    }


async def insert(db: Database, doc: Document, session: Session | None = None) -> None:
    try:
        await db[COLLECTION].insert_one(doc, session=session)
    except DuplicateKeyError as exc:
        raise Conflict("A user with this email already exists", code="email_taken") from exc


async def get(db: Database, user_id: UUID, session: Session | None = None) -> Document | None:
    return await db[COLLECTION].find_one({"_id": user_id}, session=session)


async def get_many(db: Database, user_ids: list[UUID]) -> dict[UUID, Document]:
    return {d["_id"]: d async for d in db[COLLECTION].find({"_id": {"$in": user_ids}})}


async def find_by_email(db: Database, email: str) -> Document | None:
    return await db[COLLECTION].find_one({"email": email.strip().lower()})


async def count_active_admins(db: Database, session: Session | None = None) -> int:
    return await db[COLLECTION].count_documents(
        {"role": Role.SYSTEM_ADMIN.value, "status": "active"}, session=session
    )


async def list_page(db: Database, query: PageQuery) -> list[Document]:
    cursor = db[COLLECTION].find(query.filter).sort(query.sort).limit(query.limit + 1)
    return await cursor.to_list()


async def update(
    db: Database,
    user_id: UUID,
    changes: dict[str, Any],
    *,
    expected_version: int | None = None,
    session: Session | None = None,
) -> Document:
    return await versioned_update(
        db[COLLECTION],
        {"_id": user_id},
        changes,
        expected_version=expected_version,
        not_found="User not found",
        session=session,
    )


async def record_login_failure(
    db: Database, user_id: UUID, max_failures: int, lockout: timedelta
) -> datetime | None:
    """Count a failed password; lock the account once the limit is hit. Returns locked_until."""
    doc = await db[COLLECTION].find_one_and_update(
        {"_id": user_id},
        {"$inc": {"failed_logins": 1}},
        return_document=ReturnDocument.AFTER,
    )
    if doc is None or doc["failed_logins"] < max_failures:
        return None
    locked_until = utcnow() + lockout
    await db[COLLECTION].update_one(
        {"_id": user_id}, {"$set": {"failed_logins": 0, "locked_until": locked_until}}
    )
    return locked_until


async def record_login_success(db: Database, user_id: UUID) -> None:
    await db[COLLECTION].update_one(
        {"_id": user_id},
        {"$set": {"failed_logins": 0, "locked_until": None, "last_login_at": utcnow()}},
    )
