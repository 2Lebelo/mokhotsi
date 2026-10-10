"""Shops (tenants). Every shop-owned document elsewhere carries this `_id` as `shop_id`."""

from typing import Any
from uuid import UUID, uuid4

from pymongo import ASCENDING, DESCENDING, IndexModel

from app.core.clock import utcnow
from app.core.db import Database, Document, Session
from app.core.pagination import PageQuery
from app.repositories._common import versioned_update

COLLECTION = "shops"
INDEXES = [
    IndexModel([("owner_id", ASCENDING), ("created_at", DESCENDING)], name="owner_created_at"),
    IndexModel([("created_at", DESCENDING), ("_id", DESCENDING)], name="created_at"),
    IndexModel([("name", ASCENDING), ("_id", ASCENDING)], name="name"),
]


def new_shop_doc(*, name: str, owner_id: UUID, created_by: UUID | None) -> Document:
    now = utcnow()
    return {
        "_id": uuid4(),
        "name": name.strip(),
        "owner_id": owner_id,
        "status": "active",
        "created_by": created_by,
        "created_at": now,
        "updated_at": now,
        "version": 1,
    }


async def insert(db: Database, doc: Document, session: Session | None = None) -> None:
    await db[COLLECTION].insert_one(doc, session=session)


async def get(db: Database, shop_id: UUID, session: Session | None = None) -> Document | None:
    return await db[COLLECTION].find_one({"_id": shop_id}, session=session)


async def get_many(db: Database, shop_ids: list[UUID]) -> dict[UUID, Document]:
    return {d["_id"]: d async for d in db[COLLECTION].find({"_id": {"$in": shop_ids}})}


async def list_page(db: Database, query: PageQuery) -> list[Document]:
    cursor = db[COLLECTION].find(query.filter).sort(query.sort).limit(query.limit + 1)
    return await cursor.to_list()


async def update(
    db: Database,
    shop_id: UUID,
    changes: dict[str, Any],
    *,
    expected_version: int | None = None,
    session: Session | None = None,
) -> Document:
    return await versioned_update(
        db[COLLECTION],
        {"_id": shop_id},
        changes,
        expected_version=expected_version,
        not_found="Shop not found",
        session=session,
    )
