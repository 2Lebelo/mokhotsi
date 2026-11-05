"""A shop's team: the owner creates cashiers, sets their PINs and privileges, and removes them.

A cashier has no phone number: their name and a PIN unique within the shop. Every change here
bumps the shop's roster_version, so the shop's phones pick it up on their next roster fetch.
"""

from uuid import UUID

from app.core import audit
from app.core.db import Database, Document, Session, in_transaction
from app.core.deps import ShopAccess
from app.core.errors import Conflict, NotFound
from app.core.pagination import PageParams, build_page_query
from app.core.permissions import MemberRole, Role, shop_permissions
from app.core.security import hash_pin, pin_tag
from app.repositories import member_history, memberships, sessions, shop_secrets, shops, users
from app.schemas.shops import MemberCreate, MemberOut, MemberUpdate, MemberUser
from app.services import user_service

MEMBER_SORTS = {"created_at": "created_at"}


def to_out(membership: Document, user: Document) -> MemberOut:
    role = MemberRole(membership["role"])
    return MemberOut(
        user_id=membership["user_id"],
        shop_id=membership["shop_id"],
        role=role,
        granted_permissions=membership["permissions"],
        permissions=sorted(shop_permissions(role, membership["permissions"])),
        user=MemberUser(phone=user.get("phone"), name=user["name"], status=user["status"]),
        created_at=membership["created_at"],
        updated_at=membership["updated_at"],
        version=membership["version"],
    )


async def list_members(
    db: Database, access: ShopAccess, params: PageParams, role: MemberRole | None
) -> tuple[list[MemberOut], str | None]:
    base: Document = {"shop_id": access.shop_id}
    if role is not None:
        base["role"] = role.value
    query = build_page_query(params, base, MEMBER_SORTS, "-created_at")
    docs, next_cursor = query.finish(await memberships.list_page(db, query))
    people = await users.get_many(db, [d["user_id"] for d in docs])
    return [to_out(d, people[d["user_id"]]) for d in docs if d["user_id"] in people], next_cursor


async def _get(db: Database, access: ShopAccess, user_id: UUID) -> tuple[Document, Document]:
    membership = await memberships.get(db, user_id, access.shop_id)
    user = await users.get(db, user_id) if membership else None
    if membership is None or user is None:
        raise NotFound("Member not found")
    return membership, user


async def _get_cashier(
    db: Database, access: ShopAccess, user_id: UUID
) -> tuple[Document, Document]:
    membership, user = await _get(db, access, user_id)
    if membership["role"] != MemberRole.CASHIER.value:
        raise Conflict("Only cashiers can be changed here", code="not_a_cashier")
    return membership, user


async def get_member(db: Database, access: ShopAccess, user_id: UUID) -> MemberOut:
    return to_out(*await _get(db, access, user_id))


async def _shop_key(db: Database, shop_id: UUID) -> bytes:
    key = await shop_secrets.get_key(db, shop_id)
    if key is None:  # Every shop gets one at creation (or from migration 0002).
        raise RuntimeError(f"Shop {shop_id} has no PIN key")
    return key


async def create_cashier(db: Database, access: ShopAccess, body: MemberCreate) -> MemberOut:
    actor = access.caller.actor
    user = users.new_user_doc(
        name=body.name,
        role=Role.CASHIER,
        phone=None,
        pin_hash=await hash_pin(body.pin),  # Outside the transaction: slow, and it may be retried.
        created_by=actor.id,
    )
    tag = pin_tag(await _shop_key(db, access.shop_id), body.pin)
    permissions = [p.value for p in body.permissions]

    async def write(s: Session) -> Document:
        await users.insert(db, user, s)
        await audit.record(
            db,
            actor,
            "user.created",
            entity="user",
            entity_id=user["_id"],
            shop_id=access.shop_id,
            changes=audit.snapshot(user, user_service.AUDITED_FIELDS),
            session=s,
        )
        return await user_service.add_member(
            db, actor, user["_id"], access.shop_id, MemberRole.CASHIER, tag, s, permissions
        )

    membership = await in_transaction(db, write)
    return to_out(membership, user)


async def update_member(
    db: Database,
    access: ShopAccess,
    user_id: UUID,
    body: MemberUpdate,
    expected_version: int | None,
) -> MemberOut:
    membership, user = await _get_cashier(db, access, user_id)
    permissions = [p.value for p in body.permissions]

    async def write(s: Session) -> Document:
        updated = await memberships.update_permissions(
            db, user_id, access.shop_id, permissions, expected_version=expected_version, session=s
        )
        await shops.bump_roster(db, [access.shop_id], s)
        await audit.record(
            db,
            access.caller.actor,
            "member.updated",
            entity="member",
            entity_id=user_id,
            shop_id=access.shop_id,
            changes=audit.diff(membership, updated, ("permissions",)),
            session=s,
        )
        return updated

    return to_out(await in_transaction(db, write), user)


async def remove_cashier(db: Database, access: ShopAccess, user_id: UUID) -> None:
    """Remove the cashier from the shop and disable the account (a cashier has only one shop).

    Sales they made on a phone that was offline at the time still sync (ADR 0005).
    """
    membership, user = await _get_cashier(db, access, user_id)
    actor = access.caller.actor

    async def write(s: Session) -> None:
        await memberships.delete(db, user_id, access.shop_id, s)
        # Their offline sales still sync, kept and flagged rather than refused (sync_push).
        await member_history.record_removal(db, access.shop_id, user_id, membership["role"], s)
        await users.update(db, user_id, {"status": "disabled"}, session=s)
        await sessions.revoke_all_for_user(db, user_id, "removed_from_shop", session=s)
        await shops.bump_roster(db, [access.shop_id], s)
        await audit.record(
            db,
            actor,
            "member.removed",
            entity="member",
            entity_id=user_id,
            shop_id=access.shop_id,
            changes=audit.snapshot(membership, ("role", "permissions")),
            session=s,
        )
        await audit.record(
            db,
            actor,
            "user.deactivated",
            entity="user",
            entity_id=user_id,
            shop_id=access.shop_id,
            changes={"status": {"from": user["status"], "to": "disabled"}},
            session=s,
        )

    await in_transaction(db, write)


async def reset_cashier_pin(db: Database, access: ShopAccess, user_id: UUID, pin: str) -> None:
    """The owner sets the cashier's new PIN (and tells them). It must be free in the shop."""
    await _get_cashier(db, access, user_id)
    await user_service.set_pin(
        db,
        access.caller.actor,
        user_id,
        pin,
        await hash_pin(pin),
        must_change=False,
        action="user.pin_reset",
        shop_id=access.shop_id,
    )
