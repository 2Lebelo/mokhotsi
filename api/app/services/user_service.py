"""User management (system admin), owner approval, and the caller's own account and PIN."""

import re
from uuid import UUID

from fastapi import Request

from app.core import audit
from app.core.audit import Actor
from app.core.config import Settings
from app.core.credentials import normalize_phone, random_pin
from app.core.db import Database, Document, Session, in_transaction
from app.core.deps import Caller
from app.core.errors import Conflict, NotFound, Unprocessable
from app.core.pagination import PageParams, build_page_query
from app.core.permissions import MemberRole, Role, shop_permissions
from app.core.ratelimit import limit_subject
from app.core.security import hash_pin, pin_tag, verify_pin
from app.repositories import memberships, sessions, shop_secrets, shops, users
from app.schemas.users import (
    MeOut,
    MyMembership,
    ReviewCreate,
    UserCreate,
    UserOut,
    UserUpdate,
)

USER_SORTS = {"created_at": "created_at", "name": "name"}
AUDITED_FIELDS = ("phone", "name", "role", "status", "must_change_pin")
# A server-made PIN that happens to be taken in one of the user's shops is simply redrawn.
_PIN_DRAWS = 20


def to_out(doc: Document) -> UserOut:
    return UserOut(
        id=doc["_id"],
        phone=doc.get("phone"),
        name=doc["name"],
        role=doc["role"],
        status=doc["status"],
        must_change_pin=doc.get("must_change_pin", False),
        last_login_at=doc.get("last_login_at"),
        reviewed_at=doc.get("reviewed_at"),
        review_note=doc.get("review_note"),
        created_at=doc["created_at"],
        updated_at=doc["updated_at"],
        version=doc["version"],
    )


async def get_me(db: Database, caller: Caller) -> MeOut:
    user = await users.get(db, caller.user_id)
    if user is None:
        raise NotFound("User not found")
    member_docs = await memberships.list_for_user(db, caller.user_id)
    shop_docs = await shops.get_many(db, [m["shop_id"] for m in member_docs])
    mine = [
        MyMembership(
            shop_id=m["shop_id"],
            shop_name=shop_docs[m["shop_id"]]["name"],
            shop_status=shop_docs[m["shop_id"]]["status"],
            role=m["role"],
            permissions=sorted(shop_permissions(MemberRole(m["role"]), m["permissions"])),
        )
        for m in member_docs
        if m["shop_id"] in shop_docs
    ]
    return MeOut(
        **to_out(user).model_dump(), permissions=sorted(caller.permissions), memberships=mine
    )


def _phone(raw: str, settings: Settings) -> str:
    try:
        return normalize_phone(raw, settings.default_country_code)
    except ValueError as exc:
        raise Unprocessable(str(exc), code="invalid_phone") from None


async def create_user(
    db: Database, settings: Settings, caller: Caller, body: UserCreate
) -> tuple[Document, str]:
    """An approved owner or another admin, with a temporary PIN to pass on."""
    pin = random_pin()
    doc = users.new_user_doc(
        name=body.name,
        role=Role(body.role),
        phone=_phone(body.phone, settings),
        pin_hash=await hash_pin(pin),  # Outside the transaction: slow, and it may be retried.
        must_change_pin=True,
        created_by=caller.user_id,
    )

    async def write(s: Session) -> None:
        await users.insert(db, doc, s)
        await audit.record(
            db,
            caller.actor,
            "user.created",
            entity="user",
            entity_id=doc["_id"],
            changes=audit.snapshot(doc, AUDITED_FIELDS),
            session=s,
        )

    await in_transaction(db, write)
    return doc, pin


async def add_member(
    db: Database,
    actor: Actor,
    user_id: UUID,
    shop_id: UUID,
    role: MemberRole,
    tag: str,
    s: Session,
    permissions: list[str] | None = None,
) -> Document:
    membership = memberships.new_membership_doc(
        user_id=user_id,
        shop_id=shop_id,
        role=role,
        permissions=permissions or [],
        pin_tag=tag,
        created_by=actor.id,
    )
    await memberships.insert(db, membership, s)
    await shops.bump_roster(db, [shop_id], s)
    await audit.record(
        db,
        actor,
        "member.created",
        entity="member",
        entity_id=user_id,
        shop_id=shop_id,
        changes=audit.snapshot(membership, ("role", "permissions")),
        session=s,
    )
    return membership


async def list_users(
    db: Database, params: PageParams, role: Role | None, status: str | None, q: str | None
) -> tuple[list[Document], str | None]:
    base: Document = {}
    if role is not None:
        base["role"] = role.value
    if status is not None:
        base["status"] = status
    if q and q.strip():
        term = q.strip()
        digits = re.sub(r"\D", "", term)
        base["$or"] = [{"name": {"$regex": re.escape(term), "$options": "i"}}]
        if len(digits) >= 4:  # Enough to mean a phone number, not "Shop 2".
            base["$or"].append({"phone": {"$regex": re.escape(digits)}})
    query = build_page_query(params, base, USER_SORTS, "-created_at")
    return query.finish(await users.list_page(db, query))


async def get_user(db: Database, user_id: UUID) -> Document:
    user = await users.get(db, user_id)
    if user is None:
        raise NotFound("User not found")
    return user


async def _shop_ids(db: Database, user_id: UUID, s: Session | None = None) -> list[UUID]:
    return [m["shop_id"] for m in await memberships.list_for_user(db, user_id, s)]


async def review_owner(db: Database, caller: Caller, user_id: UUID, body: ReviewCreate) -> Document:
    """Approve or reject a pending owner. A decision is final: a second one is a 409."""
    await get_user(db, user_id)
    approved = body.decision == "approve"

    async def write(s: Session) -> Document:
        updated = await users.review(
            db, user_id, "active" if approved else "rejected", caller.user_id, body.note, s
        )
        if updated is None:
            raise Conflict("This owner is not awaiting approval", code="not_pending")
        if not approved:
            await sessions.revoke_all_for_user(db, user_id, "registration_rejected", session=s)
        await audit.record(
            db,
            caller.actor,
            "user.approved" if approved else "user.rejected",
            entity="user",
            entity_id=user_id,
            changes={"status": {"from": "pending", "to": updated["status"]}},
            metadata={"note": body.note} if body.note else None,
            session=s,
        )
        return updated

    return await in_transaction(db, write)


async def update_user(
    db: Database, caller: Caller, user_id: UUID, body: UserUpdate, expected_version: int | None
) -> Document:
    user = await get_user(db, user_id)
    changes = body.model_dump(exclude_unset=True, mode="json")
    changes = {k: v for k, v in changes.items() if user.get(k) != v}
    if not changes:
        return user

    if "status" in changes:
        if user_id == caller.user_id:
            raise Conflict("You cannot change your own status", code="cannot_modify_self")
        if user["status"] in ("pending", "rejected"):
            raise Conflict(
                "Approve or reject this owner first (POST /users/{id}/reviews)",
                code="review_required",
            )
    losing_admin = (
        user["role"] == Role.SYSTEM_ADMIN.value and changes.get("status", "active") != "active"
    )
    if losing_admin and await users.count_active_admins(db) <= 1:
        raise Conflict("At least one active system admin must remain", code="last_admin")

    async def write(s: Session) -> Document:
        updated = await users.update(
            db, user_id, changes, expected_version=expected_version, session=s
        )
        # Who may sign in at the till, and their names, live in the shops' rosters.
        await shops.bump_roster(db, await _shop_ids(db, user_id, s), s)
        if changes.get("status") == "disabled":
            await sessions.revoke_all_for_user(db, user_id, "user_disabled", session=s)
        action = "user.deactivated" if changes.get("status") == "disabled" else "user.updated"
        await audit.record(
            db,
            caller.actor,
            action,
            entity="user",
            entity_id=user_id,
            changes=audit.diff(user, updated, AUDITED_FIELDS),
            session=s,
        )
        return updated

    return await in_transaction(db, write)


async def deactivate_user(db: Database, caller: Caller, user_id: UUID) -> None:
    user = await get_user(db, user_id)
    if user["status"] == "disabled":
        return  # DELETE is idempotent.
    await update_user(db, caller, user_id, UserUpdate(status="disabled"), None)


async def set_pin(
    db: Database,
    actor: Actor,
    user_id: UUID,
    pin: str,
    pin_hash: str,
    *,
    must_change: bool,
    action: str,
    keep_session: UUID | None = None,
    shop_id: UUID | None = None,
) -> None:
    """Give the user a new PIN in every shop they belong to, atomically.

    The PIN tag is recomputed with each shop's key; if any shop already has the PIN, nothing
    changes and it is a 409 `pin_taken`. Every session except `keep_session` is signed out.
    """

    async def write(s: Session) -> None:
        shop_ids = await _shop_ids(db, user_id, s)
        keys = await shop_secrets.get_keys(db, shop_ids, s)
        for member_shop in shop_ids:
            await memberships.set_pin_tag(
                db, user_id, member_shop, pin_tag(keys[member_shop], pin), s
            )
        await users.set_pin(db, user_id, pin_hash, s, must_change=must_change)
        await shops.bump_roster(db, shop_ids, s)
        await sessions.revoke_all_for_user(
            db, user_id, action, except_session=keep_session, session=s
        )
        await audit.record(
            db, actor, action, entity="user", entity_id=user_id, shop_id=shop_id, session=s
        )

    await in_transaction(db, write)


async def reset_pin(db: Database, actor: Actor, user_id: UUID) -> str:
    """A temporary PIN, free in all of the user's shops, that must be changed at sign-in."""
    for _ in range(_PIN_DRAWS):
        pin = random_pin()
        try:
            await set_pin(
                db,
                actor,
                user_id,
                pin,
                await hash_pin(pin),
                must_change=True,
                action="user.pin_reset",
            )
        except Conflict as exc:
            if exc.code == "pin_taken":
                continue
            raise
        return pin
    raise Conflict("Could not find a free PIN; try again", code="pin_taken")


async def change_own_pin(
    request: Request,
    db: Database,
    settings: Settings,
    caller: Caller,
    current_pin: str,
    new_pin: str,
) -> None:
    # `pin_taken` tells the caller a colleague uses that PIN, so tries are slowed down.
    await limit_subject(
        request,
        "pin-change",
        str(caller.user_id),
        settings.rate_limit_pin_change_per_hour,
        3_600_000,
    )
    user = await get_user(db, caller.user_id)
    if not await verify_pin(current_pin, user["pin_hash"]):
        raise Unprocessable("Your current PIN is wrong", code="invalid_current_pin")
    if new_pin == current_pin:
        raise Unprocessable("Choose a PIN different from the current one", code="pin_reused")
    await set_pin(
        db,
        caller.actor,
        caller.user_id,
        new_pin,
        await hash_pin(new_pin),
        must_change=False,
        action="user.pin_changed",
        keep_session=caller.session_id,
    )
