"""Who belongs to which shop, as owner or cashier, with the cashier's granted permissions.

An owner may hold memberships in many shops; a cashier in exactly one (partial unique index).
`pin_tag` = HMAC(shop pin_key, PIN) is unique within the shop, which is what lets a PIN alone
identify the person at the till (ADR 0005).
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
        name="cashier_one_shop",
        unique=True,
        partialFilterExpression={"role": MemberRole.CASHIER.value},
    ),
    IndexModel(
        [("shop_id", ASCENDING), ("pin_tag", ASCENDING)],
        name="shop_pin_tag_unique",
        unique=True,
        partialFilterExpression={"pin_tag": {"$type": "string"}},
    ),
]


def new_membership_doc(
    *,
    user_id: UUID,
    shop_id: UUID,
    role: MemberRole,
    permissions: list[str],
    pin_tag: str,
    created_by: UUID | None,
) -> Document:
    now = utcnow()
    return {
        "_id": uuid4(),
        "user_id": user_id,
        "shop_id": shop_id,
        "role": role.value,
        "permissions": sorted(set(permissions)),
        "pin_tag": pin_tag,
        "created_by": created_by,
        "created_at": now,
        "updated_at": now,
        "version": 1,
    }


def _pin_taken() -> Conflict:
    # Deliberately vague: it must not say whose PIN it is.
    return Conflict("Choose another PIN", code="pin_taken")


def _conflict(exc: DuplicateKeyError) -> Conflict:
    if "pin_tag" in ((exc.details or {}).get("keyPattern") or {}):
        return _pin_taken()
    return Conflict("This user already belongs to a shop", code="membership_exists")


async def insert(db: Database, doc: Document, session: Session | None = None) -> None:
    try:
        await db[COLLECTION].insert_one(doc, session=session)
    except DuplicateKeyError as exc:
        raise _conflict(exc) from exc


async def find_by_tag(
    db: Database, shop_id: UUID, pin_tag: str, session: Session | None = None
) -> Document | None:
    return await db[COLLECTION].find_one(
        {"shop_id": shop_id, "pin_tag": {"$type": "string", "$eq": pin_tag}}, session=session
    )


async def set_pin_tag(
    db: Database, user_id: UUID, shop_id: UUID, pin_tag: str, session: Session
) -> None:
    try:
        await db[COLLECTION].update_one(
            {"user_id": user_id, "shop_id": shop_id},
            {"$set": {"pin_tag": pin_tag, "updated_at": utcnow()}},
            session=session,
        )
    except DuplicateKeyError as exc:
        raise _conflict(exc) from exc


async def list_for_shops(
    db: Database, shop_ids: list[UUID], session: Session | None = None
) -> list[Document]:
    """Every member of these shops (uses the `shop_created_at` index prefix)."""
    cursor = db[COLLECTION].find({"shop_id": {"$in": shop_ids}}, session=session)
    return await cursor.to_list()


async def for_users(
    db: Database, shop_id: UUID, user_ids: list[UUID], session: Session | None = None
) -> list[Document]:
    """The memberships these people hold in this shop (uses `user_shop_unique`)."""
    if not user_ids:
        return []
    cursor = db[COLLECTION].find(
        {"user_id": {"$in": user_ids}, "shop_id": shop_id}, session=session
    )
    return await cursor.to_list()


async def get(
    db: Database, user_id: UUID, shop_id: UUID, session: Session | None = None
) -> Document | None:
    return await db[COLLECTION].find_one({"user_id": user_id, "shop_id": shop_id}, session=session)


async def list_for_user(
    db: Database, user_id: UUID, session: Session | None = None
) -> list[Document]:
    cursor = db[COLLECTION].find({"user_id": user_id}, session=session)
    return await cursor.sort("created_at", ASCENDING).to_list()


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
