"""Data migrations: ordered changes to stored documents, each applied once per database.

Each step must be idempotent: several API processes may start at once, and a crash can stop a
step halfway, so a step can run more than once before it is recorded in `schema_migrations`.
Append new steps to MIGRATIONS; never edit or reorder applied ones.
"""

import logging
from collections.abc import Awaitable, Callable
from contextlib import suppress

from bson import Binary
from pymongo.errors import DuplicateKeyError

from app.core.clock import utcnow
from app.core.db import Database
from app.core.security import new_pin_key

COLLECTION = "schema_migrations"
INDEXES: list = []

log = logging.getLogger("app.migrations")


async def _owner_cashier_roles(db: Database) -> None:
    """ADR 0005: shop_keeper/keeper became owner, shop_sitter/sitter became cashier."""
    for collection, renames in (
        ("users", {"shop_keeper": "owner", "shop_sitter": "cashier"}),
        ("memberships", {"keeper": "owner", "sitter": "cashier"}),
    ):
        for old, new in renames.items():
            await db[collection].update_many({"role": old}, {"$set": {"role": new}})


async def _pin_credentials(db: Database) -> None:
    """Everyone signs in with a PIN; owners are approved; shops get PIN keys (ADR 0005).

    Email/password accounts cannot sign in any more. They are disabled rather than deleted, so
    their history stays attributable; an admin re-enables them after a PIN reset.
    """
    await db["users"].update_many(
        {"pin_hash": {"$in": [None, ""]}, "status": {"$ne": "disabled"}},
        {"$set": {"status": "disabled"}},
    )
    await db["users"].update_many(
        {"must_change_pin": {"$exists": False}},
        [{"$set": {"must_change_pin": {"$ifNull": ["$must_change_password", False]}}}],
    )
    await db["users"].update_many(
        {"lockouts": {"$exists": False}},
        {"$set": {"lockouts": 0, "reviewed_by": None, "reviewed_at": None, "review_note": None}},
    )
    await db["users"].update_many(
        {},
        {
            "$unset": {
                "email": "",
                "password_hash": "",
                "password_changed_at": "",
                "must_change_password": "",
            }
        },
    )

    await db["shops"].update_many({"status": "archived"}, {"$set": {"status": "suspended"}})
    await db["shops"].update_many(
        {"roster_version": {"$exists": False}},
        {"$set": {"roster_version": 1, "data_claimed_by_device": None}},
    )
    async for shop in db["shops"].find({}, {"_id": 1}):
        await db["shop_secrets"].update_one(
            {"_id": shop["_id"]},
            {"$setOnInsert": {"pin_key": Binary(new_pin_key()), "created_at": utcnow()}},
            upsert=True,
        )

    # The v1 tracker upserted any id a phone sent; the registry only holds registered phones.
    await db["devices"].delete_many({"secret_hash": {"$exists": False}})


async def _sync_v2(db: Database) -> None:
    """Sync v1 documents (flat products, sales without actors, float32 embeddings) cannot be
    read as v2. No shop synced with v1; this clears any test data left behind."""
    await db["products"].delete_many({"variants": {"$exists": False}})
    await db["sales"].delete_many({"actor_user_id": {"$exists": False}})
    await db["embeddings"].delete_many({"source": {"$exists": False}})


MIGRATIONS: list[tuple[str, Callable[[Database], Awaitable[None]]]] = [
    ("0001-owner-cashier-roles", _owner_cashier_roles),
    ("0002-pin-credentials", _pin_credentials),
    ("0003-sync-v2", _sync_v2),
]


async def run_migrations(db: Database) -> list[str]:
    """Apply the steps this database has not recorded yet; returns their ids."""
    applied = {doc["_id"] async for doc in db[COLLECTION].find({}, {"_id": 1})}
    ran: list[str] = []
    for migration_id, step in MIGRATIONS:
        if migration_id in applied:
            continue
        await step(db)
        with suppress(DuplicateKeyError):  # Another process finished it at the same time.
            await db[COLLECTION].insert_one({"_id": migration_id, "applied_at": utcnow()})
        log.info("migration applied", extra={"migration": migration_id})
        ran.append(migration_id)
    return ran
