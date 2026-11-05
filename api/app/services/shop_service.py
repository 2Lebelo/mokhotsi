"""Shops: approved owners create and rename their own; the system admin suspends and reactivates.

A new shop gets its own PIN key. The owner confirms their PIN when creating it, which proves it
is them on this phone and lets the server compute their PIN tag in the new shop.
"""

import re
from datetime import timedelta
from uuid import UUID

from fastapi import Request

from app.core import audit
from app.core.clock import utcnow
from app.core.config import Settings
from app.core.db import Database, Document, Session, in_transaction
from app.core.deps import Caller
from app.core.errors import Conflict, Forbidden, Locked, NotFound, Unauthorized
from app.core.pagination import PageParams, build_page_query
from app.core.permissions import MemberRole, Perm, shop_permissions
from app.core.ratelimit import limit_attempts
from app.core.security import new_pin_key, pin_tag, verify_pin
from app.repositories import memberships, shop_secrets, shops, users
from app.schemas.shops import ShopCreate, ShopOut, ShopUpdate
from app.services import device_service
from app.services.user_service import add_member

SHOP_SORTS = {"created_at": "created_at", "name": "name"}
AUDITED_FIELDS = ("name", "owner_id", "status")


def to_out(doc: Document, membership: Document | None = None) -> ShopOut:
    out = ShopOut(
        id=doc["_id"],
        name=doc["name"],
        owner_id=doc["owner_id"],
        status=doc["status"],
        created_at=doc["created_at"],
        updated_at=doc["updated_at"],
        version=doc["version"],
    )
    if membership is not None:
        role = MemberRole(membership["role"])
        out.my_role = role
        out.my_permissions = sorted(shop_permissions(role, membership["permissions"]))
    return out


async def create_shop(
    request: Request, db: Database, settings: Settings, caller: Caller, body: ShopCreate
) -> Document:
    if not caller.has(Perm.SHOPS_CREATE_OWN):
        raise Forbidden("You do not have permission to do this", code="permission_denied")
    user = await users.get(db, caller.user_id)
    if user is None:
        raise NotFound("User not found")
    if user["locked_until"] is not None and user["locked_until"] > utcnow():
        raise Locked("Too many wrong PINs. Try again later.")
    await limit_attempts(request, "pin", str(caller.user_id), settings.rate_limit_login_per_minute)
    if not await verify_pin(body.pin, user["pin_hash"]):
        await users.record_pin_failure(
            db,
            user["_id"],
            settings.pin_max_failures,
            timedelta(seconds=settings.pin_lockout_seconds),
            timedelta(hours=settings.pin_lockout_max_hours),
        )
        raise Unauthorized("Wrong PIN", code="invalid_credentials")
    if await shops.count_owned(db, caller.user_id) >= settings.max_shops_per_owner:
        raise Conflict(
            f"An owner can have at most {settings.max_shops_per_owner} shops",
            code="shop_limit_reached",
        )

    doc = shops.new_shop_doc(name=body.name, owner_id=caller.user_id, created_by=caller.user_id)
    key = new_pin_key()

    async def write(s: Session) -> None:
        await shops.insert(db, doc, s)
        await shop_secrets.insert(db, doc["_id"], key, s)
        await audit.record(
            db,
            caller.actor,
            "shop.created",
            entity="shop",
            entity_id=doc["_id"],
            shop_id=doc["_id"],
            changes=audit.snapshot(doc, AUDITED_FIELDS),
            session=s,
        )
        await add_member(
            db,
            caller.actor,
            caller.user_id,
            doc["_id"],
            MemberRole.OWNER,
            pin_tag(key, body.pin),
            s,
        )
        if caller.device_id is not None:
            await device_service.link_to_shop(db, caller.actor, caller.device_id, doc["_id"], s)

    await in_transaction(db, write)
    return doc


async def list_shops(
    db: Database,
    caller: Caller,
    params: PageParams,
    owner_id: UUID | None,
    status: str | None,
    q: str | None,
) -> tuple[list[ShopOut], str | None]:
    base: Document = {}
    mine: dict[UUID, Document] = {}
    if not caller.has(Perm.SHOPS_READ_ALL):
        mine = {m["shop_id"]: m for m in await memberships.list_for_user(db, caller.user_id)}
        base["_id"] = {"$in": list(mine)}
    if owner_id is not None:
        base["owner_id"] = owner_id
    if status is not None:
        base["status"] = status
    if q:
        base["name"] = {"$regex": re.escape(q.strip()), "$options": "i"}
    query = build_page_query(params, base, SHOP_SORTS, "name")
    docs, next_cursor = query.finish(await shops.list_page(db, query))
    return [to_out(d, mine.get(d["_id"])) for d in docs], next_cursor


async def _resolve(db: Database, caller: Caller, shop_id: UUID) -> tuple[Document, Document | None]:
    """The shop plus the caller's membership (None for an admin). 404 for outsiders."""
    shop = await shops.get(db, shop_id)
    if shop is None:
        raise NotFound("Shop not found")
    membership = await memberships.get(db, caller.user_id, shop_id)
    if membership is None and not caller.has(Perm.SHOPS_READ_ALL):
        raise NotFound("Shop not found")
    return shop, membership


async def get_shop(db: Database, caller: Caller, shop_id: UUID) -> ShopOut:
    shop, membership = await _resolve(db, caller, shop_id)
    return to_out(shop, membership)


async def update_shop(
    db: Database, caller: Caller, shop_id: UUID, body: ShopUpdate, expected_version: int | None
) -> ShopOut:
    shop, membership = await _resolve(db, caller, shop_id)
    changes = {k: v for k, v in body.model_dump(exclude_unset=True).items() if shop.get(k) != v}
    manages = membership is not None and Perm.SHOP_MANAGE in shop_permissions(
        MemberRole(membership["role"]), membership["permissions"]
    )
    if "status" in changes and not caller.has(Perm.SHOPS_WRITE_ALL):
        raise Forbidden("Only a system admin can suspend a shop", code="permission_denied")
    if "name" in changes and not (manages or caller.has(Perm.SHOPS_WRITE_ALL)):
        raise Forbidden("You do not have permission to do this", code="permission_denied")
    if "name" in changes and shop["status"] == "suspended" and not caller.has(Perm.SHOPS_WRITE_ALL):
        raise Forbidden("This shop is suspended", code="shop_suspended")
    if not changes:
        return to_out(shop, membership)

    async def write(s: Session) -> Document:
        updated = await shops.update(
            db, shop_id, changes, expected_version=expected_version, session=s
        )
        await shops.bump_roster(db, [shop_id], s)  # Phones show the shop's name and status.
        action = {"suspended": "shop.suspended", "active": "shop.reactivated"}.get(
            changes.get("status", ""), "shop.updated"
        )
        await audit.record(
            db,
            caller.actor,
            action,
            entity="shop",
            entity_id=shop_id,
            shop_id=shop_id,
            changes=audit.diff(shop, updated, AUDITED_FIELDS),
            session=s,
        )
        return updated

    return to_out(await in_transaction(db, write), membership)
