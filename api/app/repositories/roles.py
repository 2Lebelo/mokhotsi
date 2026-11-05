"""Roles: one document per role, `_id` = the role name stored on `users.role`.

The built-in roles are defined in code (app.core.permissions), which is what authorization
checks. This collection mirrors them so they can be listed, referenced and reported on with the
rest of the data. `sync_builtin_roles` runs at every startup: it creates missing roles, puts back
any definition that differs from the code, and marks roles the code no longer has as retired
(never deleting them, since users may still refer to them). Every change is audited, so a hand
edit in the database is both undone and visible.
"""

from typing import Any

from pymongo import ASCENDING, IndexModel
from pymongo.errors import DuplicateKeyError

from app.core import audit
from app.core.audit import Actor
from app.core.clock import utcnow
from app.core.db import Database, Document, Session, in_transaction
from app.core.permissions import (
    ROLE_DESCRIPTIONS,
    ROLE_NAMES,
    ROLE_SHOP_DEFAULTS,
    ROLE_SHOP_GRANTABLE,
    SYSTEM_PERMISSIONS,
    Role,
)

COLLECTION = "roles"
INDEXES = [IndexModel([("retired", ASCENDING), ("_id", ASCENDING)], name="retired_id")]

# The fields that define a role; anything else (timestamps, version) is bookkeeping.
DEFINITION_FIELDS = (
    "name",
    "description",
    "scope",
    "system_permissions",
    "shop_permissions",
    "grantable_shop_permissions",
    "built_in",
    "retired",
)
_SYNC_ACTOR = Actor.system("role-sync")


def builtin_definition(role: Role) -> dict[str, Any]:
    """What the document for `role` must contain, derived from app.core.permissions."""
    return {
        "name": ROLE_NAMES[role],
        "description": ROLE_DESCRIPTIONS[role],
        "scope": "system" if role is Role.SYSTEM_ADMIN else "shop",
        "system_permissions": sorted(SYSTEM_PERMISSIONS[role]),
        "shop_permissions": sorted(ROLE_SHOP_DEFAULTS[role]),
        "grantable_shop_permissions": sorted(ROLE_SHOP_GRANTABLE[role]),
        "built_in": True,
        "retired": False,
    }


async def list_active(db: Database) -> list[Document]:
    cursor = db[COLLECTION].find({"retired": False}).sort("_id", ASCENDING)
    return await cursor.to_list()


async def get(db: Database, role_id: str, session: Session | None = None) -> Document | None:
    return await db[COLLECTION].find_one({"_id": role_id}, session=session)


async def sync_builtin_roles(db: Database) -> list[str]:
    """Make the collection match the code. Idempotent and safe to run from several processes
    at once. Returns the ids of the roles it changed."""
    changed: list[str] = []
    wanted = {role.value: builtin_definition(role) for role in Role}
    for role_id, definition in wanted.items():
        if await _sync_one(db, role_id, definition):
            changed.append(role_id)
    stale = db[COLLECTION].find({"_id": {"$nin": list(wanted)}, "built_in": True, "retired": False})
    async for doc in stale:
        if await _sync_one(db, doc["_id"], {**_definition_of(doc), "retired": True}):
            changed.append(doc["_id"])
    return changed


def _definition_of(doc: Document) -> dict[str, Any]:
    return {f: doc.get(f) for f in DEFINITION_FIELDS}


async def _sync_one(db: Database, role_id: str, definition: dict[str, Any]) -> bool:
    async def write(s: Session) -> bool:
        current = await get(db, role_id, s)
        now = utcnow()
        if current is None:
            doc = {"_id": role_id, **definition, "created_at": now, "updated_at": now, "version": 1}
            await db[COLLECTION].insert_one(doc, session=s)
            await audit.record(
                db,
                _SYNC_ACTOR,
                "role.created",
                entity="role",
                entity_id=role_id,
                changes=audit.snapshot(doc, DEFINITION_FIELDS),
                session=s,
            )
            return True
        if _definition_of(current) == definition:
            return False
        result = await db[COLLECTION].update_one(
            {"_id": role_id, "version": current["version"]},
            {"$set": {**definition, "updated_at": now}, "$inc": {"version": 1}},
            session=s,
        )
        if result.modified_count != 1:
            return False  # Another process synced it first.
        await audit.record(
            db,
            _SYNC_ACTOR,
            "role.retired"
            if definition["retired"] and not current.get("retired")
            else "role.updated",
            entity="role",
            entity_id=role_id,
            changes=audit.diff(current, definition, DEFINITION_FIELDS),
            session=s,
        )
        return True

    try:
        return await in_transaction(db, write)
    except DuplicateKeyError:
        return False  # Another process created it first.
