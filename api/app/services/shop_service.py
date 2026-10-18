"""Shops: admins see and manage all of them; keepers create and manage their own."""

import re
from uuid import UUID

from app.core import audit
from app.core.db import Database, Document, Session, in_transaction
from app.core.deps import Caller
from app.core.errors import Forbidden, NotFound, Unprocessable
from app.core.pagination import PageParams, build_page_query
from app.core.permissions import MemberRole, Perm, Role, shop_permissions
from app.repositories import memberships, shops, users
from app.schemas.shops import ShopCreate, ShopOut, ShopUpdate
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


async def create_shop(db: Database, caller: Caller, body: ShopCreate) -> Document:
    if caller.has(Perm.SHOPS_WRITE_ALL):
        if body.owner_id is None:
            raise Unprocessable("owner_id is required", code="owner_required")
        owner = await users.get(db, body.owner_id)
        if owner is None or owner["role"] != Role.SHOP_KEEPER.value or owner["status"] != "active":
            raise Unprocessable("owner_id must be an active shop_keeper", code="invalid_owner")
        owner_id = body.owner_id
    elif caller.has(Perm.SHOPS_CREATE_OWN):
        if body.owner_id not in (None, caller.user_id):
            raise Forbidden("You can only create shops you own", code="permission_denied")
        owner_id = caller.user_id
    else:
        raise Forbidden("You do not have permission to do this", code="permission_denied")

    doc = shops.new_shop_doc(name=body.name, owner_id=owner_id, created_by=caller.user_id)

    async def write(s: Session) -> None:
        await shops.insert(db, doc, s)
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
        await add_member(db, caller.actor, owner_id, doc["_id"], MemberRole.KEEPER, s)

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
    allowed = caller.has(Perm.SHOPS_WRITE_ALL) or (
        membership is not None
        and Perm.SHOP_MANAGE
        in shop_permissions(MemberRole(membership["role"]), membership["permissions"])
    )
    if not allowed:
        raise Forbidden("You do not have permission to do this", code="permission_denied")
    changes = {k: v for k, v in body.model_dump(exclude_unset=True).items() if shop.get(k) != v}
    if not changes:
        return to_out(shop, membership)

    async def write(s: Session) -> Document:
        updated = await shops.update(
            db, shop_id, changes, expected_version=expected_version, session=s
        )
        await audit.record(
            db,
            caller.actor,
            "shop.updated",
            entity="shop",
            entity_id=shop_id,
            shop_id=shop_id,
            changes=audit.diff(shop, updated, AUDITED_FIELDS),
            session=s,
        )
        return updated

    return to_out(await in_transaction(db, write), membership)
