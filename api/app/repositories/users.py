"""Users: one document per person (ADR 0005).

Everyone signs in with a 5-digit PIN, stored only as an Argon2 hash. Owners and admins also
have a phone number (E.164, unique), which identifies them on any phone. Cashiers have no
phone: their PIN identifies them within their shop (see memberships.pin_tag).

Status: an owner who registers is `pending` until the admin approves (`active`) or rejects
(`rejected`) them. `disabled` users cannot sign in.
"""

from datetime import datetime, timedelta
from typing import Any, Literal
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
UserStatus = Literal["pending", "active", "rejected", "disabled"]

# Queries must repeat `$type: "string"` so the planner can use the partial index.
_SET = {"$type": "string"}
INDEXES = [
    IndexModel(
        [("phone", ASCENDING)],
        name="phone_unique_when_set",
        unique=True,
        partialFilterExpression={"phone": _SET},
    ),
    IndexModel([("created_at", DESCENDING), ("_id", DESCENDING)], name="created_at"),
    # The admin's approval queue: GET /users?role=owner&status=pending, oldest or newest first.
    IndexModel(
        [
            ("role", ASCENDING),
            ("status", ASCENDING),
            ("created_at", DESCENDING),
            ("_id", DESCENDING),
        ],
        name="role_status_created_at",
    ),
]


def new_user_doc(
    *,
    name: str,
    role: Role,
    pin_hash: str,
    phone: str | None,
    created_by: UUID | None,
    status: UserStatus = "active",
    must_change_pin: bool = False,
) -> Document:
    """`phone` must already be E.164 (see app.core.credentials) and the PIN hashed."""
    if (phone is None) != (role is Role.CASHIER):
        raise ValueError("Owners and admins have a phone number; cashiers do not")
    now = utcnow()
    return {
        "_id": uuid4(),
        "phone": phone,
        "name": name.strip(),
        "role": role.value,
        "status": status,
        "pin_hash": pin_hash,
        "must_change_pin": must_change_pin,
        "failed_logins": 0,
        "lockouts": 0,
        "locked_until": None,
        "last_login_at": None,
        "pin_changed_at": now,
        "reviewed_by": None,
        "reviewed_at": None,
        "review_note": None,
        "created_by": created_by,
        "created_at": now,
        "updated_at": now,
        "version": 1,
    }


async def insert(db: Database, doc: Document, session: Session | None = None) -> None:
    try:
        await db[COLLECTION].insert_one(doc, session=session)
    except DuplicateKeyError as exc:
        raise Conflict("A user with this phone number already exists", code="phone_taken") from exc


async def get(db: Database, user_id: UUID, session: Session | None = None) -> Document | None:
    return await db[COLLECTION].find_one({"_id": user_id}, session=session)


async def get_many(
    db: Database, user_ids: list[UUID], session: Session | None = None
) -> dict[UUID, Document]:
    cursor = db[COLLECTION].find({"_id": {"$in": user_ids}}, session=session)
    return {d["_id"]: d async for d in cursor}


async def find_by_phone(
    db: Database, phone: str, session: Session | None = None
) -> Document | None:
    """`phone` in E.164."""
    return await db[COLLECTION].find_one({"phone": {**_SET, "$eq": phone}}, session=session)


async def set_pin(
    db: Database,
    user_id: UUID,
    pin_hash: str,
    session: Session | None = None,
    *,
    must_change: bool = False,
) -> Document:
    """Replace the PIN and lift any lockout; the old PIN stops working at once."""
    return await update(
        db,
        user_id,
        {
            "pin_hash": pin_hash,
            "pin_changed_at": utcnow(),
            "must_change_pin": must_change,
            "failed_logins": 0,
            "lockouts": 0,
            "locked_until": None,
        },
        session=session,
    )


async def upgrade_pin_hash(db: Database, user_id: UUID, old_hash: str, new_hash: str) -> None:
    """Re-store the same PIN under current hashing parameters (no-op if it changed meanwhile)."""
    await db[COLLECTION].update_one(
        {"_id": user_id, "pin_hash": old_hash}, {"$set": {"pin_hash": new_hash}}
    )


async def review(
    db: Database,
    user_id: UUID,
    status: Literal["active", "rejected"],
    reviewer: UUID,
    note: str | None,
    session: Session,
) -> Document | None:
    """Approve or reject a pending owner. None if they are no longer pending (one decision)."""
    now = utcnow()
    return await db[COLLECTION].find_one_and_update(
        {"_id": user_id, "role": Role.OWNER.value, "status": "pending"},
        {
            "$set": {
                "status": status,
                "reviewed_by": reviewer,
                "reviewed_at": now,
                "review_note": note,
                "updated_at": now,
            },
            "$inc": {"version": 1},
        },
        return_document=ReturnDocument.AFTER,
        session=session,
    )


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


async def record_pin_failure(
    db: Database, user_id: UUID, max_failures: int, base: timedelta, cap: timedelta
) -> datetime | None:
    """Count a wrong PIN; lock the account once the limit is hit. Returns locked_until.

    Each lockout lasts twice as long as the one before (base, 2 x base, ... up to cap), so an
    attacker gets a few dozen guesses a day at most. A correct PIN resets the count.
    """
    doc = await db[COLLECTION].find_one_and_update(
        {"_id": user_id},
        {"$inc": {"failed_logins": 1}},
        return_document=ReturnDocument.AFTER,
    )
    if doc is None or doc["failed_logins"] < max_failures:
        return None
    lockouts = min(doc.get("lockouts", 0), 20)  # Past 2**20 x base it is the cap anyway.
    locked_until = utcnow() + min(base * (2**lockouts), cap)
    # Conditional, so two simultaneous failures lock once rather than doubling twice.
    result = await db[COLLECTION].update_one(
        {"_id": user_id, "failed_logins": {"$gte": max_failures}},
        {
            "$set": {"failed_logins": 0, "locked_until": locked_until},
            "$inc": {"lockouts": 1},
        },
    )
    return locked_until if result.modified_count else None


async def record_login_success(db: Database, user_id: UUID) -> None:
    await db[COLLECTION].update_one(
        {"_id": user_id},
        {
            "$set": {
                "failed_logins": 0,
                "lockouts": 0,
                "locked_until": None,
                "last_login_at": utcnow(),
            }
        },
    )
