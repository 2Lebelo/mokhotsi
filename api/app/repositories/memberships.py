"""Who belongs to which shop, as keeper or sitter, with the sitter's granted permissions.

A keeper may hold memberships in many shops; a sitter in exactly one (partial unique index).
"""

from uuid import UUID, uuid4

from pymongo import ASCENDING, DESCENDING, IndexModel
from pymongo.errors import DuplicateKeyError

from app.core.clock import utcnow
from app.core.db import Database, Document, Session
from app.core.errors import Conflict
from app.core.pagination import PageQuery
from app.core.permissions import MemberRole
from app.repositories._common import versioned_update

COLLECTION = "memberships"
INDEXES = [
    IndexModel(
        [("user_id", ASCENDING), ("shop_id", ASCENDING)], name="user_shop_unique", unique=True
    ),
    IndexModel(
        [("shop_id", ASCENDING), ("created_at", DESCENDING), ("_id", DESCENDING)],
        name="shop_created_at",
    ),
    IndexModel(
        [("user_id", ASCENDING)],
        name="sitter_one_shop",
        unique=True,
        partialFilterExpression={"role": MemberRole.SITTER.value},
    ),
]


def new_membership_doc(
    *,
    user_id: UUID,
    shop_id: UUID,
    role: MemberRole,
    permissions: list[str],
    created_by: UUID | None,
) -> Document:
    now = utcnow()
    return {
        "_id": uuid4(),
        "user_id": user_id,
        "shop_id": shop_id,
        "role": role.value,
        "permissions": sorted(set(permissions)),
        "created_by": created_by,
        "created_at": now,
        "updated_at": now,
        "version": 1,
    }


async def insert(db: Database, doc: Document, session: Session | None = None) -> None:
    try:
        await db[COLLECTION].insert_one(doc, session=session)
    except DuplicateKeyError as exc:
        raise Conflict("This user already belongs to a shop", code="membership_exists") from exc


async def get(
    db: Database, user_id: UUID, shop_id: UUID, session: Session | None = None
) -> Document | None:
    return await db[COLLECTION].find_one({"user_id": user_id, "shop_id": shop_id}, session=session)


async def list_for_user(db: Database, user_id: UUID) -> list[Document]:
    return await db[COLLECTION].find({"user_id": user_id}).sort("created_at", ASCENDING).to_list()


async def list_page(db: Database, query: PageQuery) -> list[Document]:
    cursor = db[COLLECTION].find(query.filter).sort(query.sort).limit(query.limit + 1)
    return await cursor.to_list()


async def update_permissions(
    db: Database,
    user_id: UUID,
    shop_id: UUID,
    permissions: list[str],
    *,
    expected_version: int | None,
    session: Session | None = None,
) -> Document:
    return await versioned_update(
        db[COLLECTION],
        {"user_id": user_id, "shop_id": shop_id},
        {"permissions": sorted(set(permissions))},
        expected_version=expected_version,
        not_found="Member not found",
        session=session,
    )


async def delete(
    db: Database, user_id: UUID, shop_id: UUID, session: Session | None = None
) -> bool:
    result = await db[COLLECTION].delete_one(
        {"user_id": user_id, "shop_id": shop_id}, session=session
    )
    return result.deleted_count == 1
