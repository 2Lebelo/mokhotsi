"""Roles as stored in the `roles` collection (kept in step with app.core.permissions)."""

from app.core.db import Database
from app.repositories import roles
from app.schemas.audit import RoleOut


async def list_roles(db: Database) -> list[RoleOut]:
    return [
        RoleOut(
            name=doc["_id"],
            title=doc["name"],
            scope=doc["scope"],
            description=doc["description"],
            system_permissions=doc["system_permissions"],
            default_shop_permissions=doc["shop_permissions"],
            grantable_shop_permissions=doc["grantable_shop_permissions"],
        )
        for doc in await roles.list_active(db)
    ]
