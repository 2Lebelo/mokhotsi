"""Shops (tenants). Every shop-owned document elsewhere carries this `_id` as `shop_id`.

`roster_version` goes up in the same transaction as any change to who can sign in to the shop
(members, PINs, permissions, the shop's name or status); phones use it to fetch the roster
only when it changed. `data_claimed_by_device` is set once, by the first phone that moves
its offline data into the shop, so two phones never upload two copies of a catalogue.
"""

from typing import Any, Literal
from uuid import UUID, uuid4

from pymongo import ASCENDING, DESCENDING, IndexModel

from app.core.clock import utcnow
from app.core.db import Database, Document, Session
from app.core.pagination import PageQuery
from app.repositories._common import versioned_update

COLLECTION = "shops"
ShopStatus = Literal["active", "suspended"]
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
        "roster_version": 1,
        "data_claimed_by_device": None,
        "created_by": created_by,
        "created_at": now,
        "updated_at": now,
        "version": 1,
    }


async def insert(db: Database, doc: Document, session: Session | None = None) -> None:
    await db[COLLECTION].insert_one(doc, session=session)


async def get(db: Database, shop_id: UUID, session: Session | None = None) -> Document | None:
    return await db[COLLECTION].find_one({"_id": shop_id}, session=session)


async def get_many(
    db: Database, shop_ids: list[UUID], session: Session | None = None
) -> dict[UUID, Document]:
    cursor = db[COLLECTION].find({"_id": {"$in": shop_ids}}, session=session)
    return {d["_id"]: d async for d in cursor}


async def roster_versions(db: Database, shop_ids: list[UUID]) -> dict[UUID, int]:
    """Just the versions: a covered read on `_id`, for the roster's ETag."""
    cursor = db[COLLECTION].find({"_id": {"$in": shop_ids}}, {"roster_version": 1})
    return {d["_id"]: d.get("roster_version", 1) async for d in cursor}


async def count_owned(db: Database, owner_id: UUID, session: Session | None = None) -> int:
    return await db[COLLECTION].count_documents({"owner_id": owner_id}, session=session)


async def bump_roster(db: Database, shop_ids: list[UUID], session: Session | None = None) -> None:
    if shop_ids:
        await db[COLLECTION].update_many(
            {"_id": {"$in": shop_ids}}, {"$inc": {"roster_version": 1}}, session=session
        )


async def claim_data(db: Database, shop_id: UUID, device_id: UUID) -> bool:
    """Record `device_id` as the one phone whose offline data seeds the shop (once, atomic).

    True if this phone holds the claim, including when it already did (a retry).
    """
    await db[COLLECTION].update_one(
        {"_id": shop_id, "data_claimed_by_device": None},
        {"$set": {"data_claimed_by_device": device_id, "updated_at": utcnow()}},
    )
    shop = await db[COLLECTION].find_one({"_id": shop_id}, {"data_claimed_by_device": 1})
    return shop is not None and shop["data_claimed_by_device"] == device_id


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
