"""Registered phones: registration, linking to shops, revocation and the offline roster.

A phone holds the roster of every shop it is linked to: the shop's PIN key and each active
member's PIN tag, name, role and permissions. With it the phone checks PINs offline. The
roster is cheap to poll: its ETag is built from versions alone, so an unchanged roster is a
304 after one covered read.
"""

import base64
import hashlib
from uuid import UUID

from app.core import audit
from app.core.audit import Actor
from app.core.db import Database, Document, Session, in_transaction
from app.core.deps import Caller, DeviceCaller, ShopAccess
from app.core.errors import Conflict, NotFound, Unauthorized
from app.core.pagination import PageParams, build_page_query
from app.core.permissions import MemberRole, Perm, shop_permissions
from app.core.security import hash_secret, new_device_secret, secrets_match
from app.repositories import devices, memberships, sessions, shop_secrets, shops, users
from app.schemas.devices import DeviceOut, RosterMember, RosterOut, RosterShop

DEVICE_SORTS = {"created_at": "created_at"}
AUDITED_FIELDS = ("name", "platform", "registered_by", "shop_ids")


def to_out(doc: Document) -> DeviceOut:
    return DeviceOut(
        id=doc["_id"],
        name=doc["name"],
        platform=doc["platform"],
        registered_by=doc["registered_by"],
        shop_ids=doc["shop_ids"],
        created_at=doc["created_at"],
        last_seen_at=doc["last_seen_at"],
        last_sync_at=doc["last_sync_at"],
        revoked_at=doc["revoked_at"],
    )


def new_device(user_id: UUID, name: str, platform: str) -> tuple[Document, str]:
    """A device document and its secret (returned to the phone once, never stored)."""
    secret = new_device_secret()
    doc = devices.new_device_doc(
        name=name, platform=platform, registered_by=user_id, secret_hash=hash_secret(secret)
    )
    return doc, secret


async def insert_device(db: Database, actor: Actor, doc: Document, s: Session) -> None:
    await devices.insert(db, doc, s)
    await audit.record(
        db,
        actor,
        "device.registered",
        entity="device",
        entity_id=doc["_id"],
        changes=audit.snapshot(doc, AUDITED_FIELDS),
        session=s,
    )


async def authenticate(db: Database, device_id: UUID, secret: str) -> Document:
    device = await devices.get(db, device_id)
    if device is None or not secrets_match(secret, device["secret_hash"]):
        raise Unauthorized("This phone is not registered", code="invalid_device")
    if device["revoked_at"] is not None:
        raise Unauthorized("This phone is no longer registered", code="device_revoked")
    return device


async def _linkable(db: Database, caller: Caller, device_id: UUID) -> Document:
    """A phone the caller may add to a shop: the one they are using, or one they registered."""
    device = await devices.get(db, device_id)
    if device is None or device["revoked_at"] is not None:
        raise NotFound("Device not found")
    if device_id != caller.device_id and device["registered_by"] != caller.user_id:
        raise NotFound("Device not found")
    return device


async def link_to_shop(
    db: Database, actor: Actor, device_id: UUID, shop_id: UUID, s: Session
) -> Document:
    device = await devices.link_shop(db, device_id, shop_id, s)
    if device is None:
        raise NotFound("Device not found")
    await audit.record(
        db, actor, "device.linked", entity="device", entity_id=device_id, shop_id=shop_id, session=s
    )
    return device


async def link_device(db: Database, access: ShopAccess, device_id: UUID) -> DeviceOut:
    await _linkable(db, access.caller, device_id)
    doc = await in_transaction(
        db, lambda s: link_to_shop(db, access.caller.actor, device_id, access.shop_id, s)
    )
    return to_out(doc)


async def unlink_device(db: Database, access: ShopAccess, device_id: UUID) -> None:
    async def write(s: Session) -> None:
        if await devices.unlink_shop(db, device_id, access.shop_id, s):
            await audit.record(
                db,
                access.caller.actor,
                "device.unlinked",
                entity="device",
                entity_id=device_id,
                shop_id=access.shop_id,
                session=s,
            )

    await in_transaction(db, write)


async def list_shop_devices(
    db: Database, access: ShopAccess, params: PageParams
) -> tuple[list[DeviceOut], str | None]:
    query = build_page_query(params, {"shop_ids": access.shop_id}, DEVICE_SORTS, "-created_at")
    docs, next_cursor = query.finish(await devices.list_page(db, query))
    return [to_out(d) for d in docs], next_cursor


async def list_devices(
    db: Database, params: PageParams, registered_by: UUID | None, shop_id: UUID | None
) -> tuple[list[DeviceOut], str | None]:
    """Every phone (system admin), optionally for one person or shop."""
    base: Document = {}
    if registered_by is not None:
        base["registered_by"] = registered_by
    if shop_id is not None:
        base["shop_ids"] = shop_id
    query = build_page_query(params, base, DEVICE_SORTS, "-created_at")
    docs, next_cursor = query.finish(await devices.list_page(db, query))
    return [to_out(d) for d in docs], next_cursor


async def _may_revoke(db: Database, caller: Caller, device: Document) -> bool:
    if caller.has(Perm.USERS_WRITE) or device["registered_by"] == caller.user_id:
        return True
    for shop_id in device["shop_ids"]:
        membership = await memberships.get(db, caller.user_id, shop_id)
        if membership and Perm.DEVICES_MANAGE in shop_permissions(
            MemberRole(membership["role"]), membership["permissions"]
        ):
            return True
    return False


async def revoke_device(db: Database, caller: Caller, device_id: UUID) -> None:
    """The phone stops syncing and everyone signed in on it is signed out. Idempotent."""
    device = await devices.get(db, device_id)
    if device is None or not await _may_revoke(db, caller, device):
        raise NotFound("Device not found")
    if device["revoked_at"] is not None:
        return

    async def write(s: Session) -> None:
        if not await devices.revoke(db, device_id, caller.user_id, s):
            return
        await sessions.revoke_all_for_device(db, device_id, "device_revoked", session=s)
        await audit.record(
            db, caller.actor, "device.revoked", entity="device", entity_id=device_id, session=s
        )

    await in_transaction(db, write)


async def claim_data(db: Database, access: ShopAccess) -> UUID:
    """Let the caller's phone seed the shop with its offline data, if no other phone did."""
    device_id = access.caller.device_id
    device = await devices.get(db, device_id) if device_id else None
    if device is None or access.shop_id not in device["shop_ids"]:
        raise Conflict("Register this phone to the shop first", code="device_not_linked")
    if not await shops.claim_data(db, access.shop_id, device["_id"]):
        raise Conflict(
            "Another phone already moved its data into this shop", code="data_already_claimed"
        )
    await audit.record(
        db,
        access.caller.actor,
        "shop.data_claimed",
        entity="shop",
        entity_id=access.shop_id,
        shop_id=access.shop_id,
        metadata={"device_id": device["_id"]},
    )
    return device["_id"]


def roster_etag(device: Document, versions: dict[UUID, int]) -> str:
    parts = [str(device["_id"]), str(device["version"])]
    parts += [f"{shop_id}:{versions.get(shop_id, 0)}" for shop_id in sorted(device["shop_ids"])]
    return '"' + hashlib.sha256("|".join(parts).encode()).hexdigest()[:32] + '"'


async def current_roster_etag(db: Database, device: Document) -> str:
    return roster_etag(device, await shops.roster_versions(db, device["shop_ids"]))


async def roster(db: Database, caller: DeviceCaller) -> RosterOut:
    shop_ids = caller.device["shop_ids"]
    shop_docs = await shops.get_many(db, shop_ids)
    keys = await shop_secrets.get_keys(db, shop_ids)
    member_docs = await memberships.list_for_shops(db, shop_ids)
    people = await users.get_many(db, list({m["user_id"] for m in member_docs}))

    by_shop: dict[UUID, list[RosterMember]] = {shop_id: [] for shop_id in shop_ids}
    for m in member_docs:
        user = people.get(m["user_id"])
        if user is None or user["status"] != "active":
            continue
        role = MemberRole(m["role"])
        by_shop[m["shop_id"]].append(
            RosterMember(
                user_id=user["_id"],
                name=user["name"],
                role=role,
                permissions=sorted(shop_permissions(role, m["permissions"])),
                pin_tag=m.get("pin_tag"),
                must_change_pin=user.get("must_change_pin", False),
            )
        )
    return RosterOut(
        device_id=caller.device_id,
        shops=[
            RosterShop(
                id=shop["_id"],
                name=shop["name"],
                status=shop["status"],
                roster_version=shop.get("roster_version", 1),
                pin_key=base64.b64encode(keys[shop["_id"]]).decode(),
                data_claimed_by_device=shop.get("data_claimed_by_device"),
                members=sorted(by_shop[shop["_id"]], key=lambda r: r.name.lower()),
            )
            for shop_id in shop_ids
            if (shop := shop_docs.get(shop_id)) is not None and shop_id in keys
        ],
    )
