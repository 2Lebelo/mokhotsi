"""User management (system admin) and the caller's own account."""

import re
from uuid import UUID

from app.core import audit
from app.core.audit import Actor
from app.core.clock import utcnow
from app.core.db import Database, Document, Session, in_transaction
from app.core.deps import Caller
from app.core.errors import Conflict, NotFound, Unprocessable
from app.core.pagination import PageParams, build_page_query
from app.core.permissions import SYSTEM_PERMISSIONS, MemberRole, Role, shop_permissions
from app.core.security import hash_password, verify_password
from app.repositories import memberships, sessions, shops, users
from app.schemas.users import MeOut, MyMembership, UserCreate, UserOut, UserUpdate

USER_SORTS = {"created_at": "created_at", "email": "email", "name": "name"}
AUDITED_FIELDS = ("email", "name", "role", "status", "must_change_password")


def to_out(doc: Document) -> UserOut:
    return UserOut(
        id=doc["_id"],
        email=doc["email"],
        name=doc["name"],
        role=doc["role"],
        status=doc["status"],
        must_change_password=doc["must_change_password"],
        last_login_at=doc.get("last_login_at"),
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
        **to_out(user).model_dump(),
        permissions=sorted(SYSTEM_PERMISSIONS[Role(user["role"])]),
        memberships=mine,
    )


async def create_user(db: Database, caller: Caller, body: UserCreate) -> Document:
    if body.shop_id is not None:
        shop = await shops.get(db, body.shop_id)
        if shop is None:
            raise Unprocessable("shop_id does not exist", code="shop_not_found")
    doc = users.new_user_doc(
        email=str(body.email),
        name=body.name,
        role=body.role,
        password_hash=hash_password(body.password),  # Outside the transaction: slow on purpose.
        must_change_password=True,
        created_by=caller.user_id,
    )
    initial_shop = (
        shops.new_shop_doc(name=body.shop_name, owner_id=doc["_id"], created_by=caller.user_id)
        if body.shop_name
        else None
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
        if body.shop_id is not None:
            await add_member(db, caller.actor, doc["_id"], body.shop_id, MemberRole.SITTER, s)
        if initial_shop is not None:
            await shops.insert(db, initial_shop, s)
            await audit.record(
                db,
                caller.actor,
                "shop.created",
                entity="shop",
                entity_id=initial_shop["_id"],
                shop_id=initial_shop["_id"],
                changes=audit.snapshot(initial_shop, ("name", "owner_id", "status")),
                session=s,
            )
            await add_member(
                db, caller.actor, doc["_id"], initial_shop["_id"], MemberRole.KEEPER, s
            )

    await in_transaction(db, write)
    return doc


async def add_member(
    db: Database,
    actor: Actor,
    user_id: UUID,
    shop_id: UUID,
    role: MemberRole,
    s: Session,
    permissions: list[str] | None = None,
) -> Document:
    membership = memberships.new_membership_doc(
        user_id=user_id,
        shop_id=shop_id,
        role=role,
        permissions=permissions or [],
        created_by=actor.id,
    )
    await memberships.insert(db, membership, s)
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
    if q:
        base["$or"] = [
            {"email": {"$regex": "^" + re.escape(q.strip().lower())}},
            {"name": {"$regex": re.escape(q.strip()), "$options": "i"}},
        ]
    query = build_page_query(params, base, USER_SORTS, "-created_at")
    return query.finish(await users.list_page(db, query))


async def get_user(db: Database, user_id: UUID) -> Document:
    user = await users.get(db, user_id)
    if user is None:
        raise NotFound("User not found")
    return user


async def update_user(
    db: Database, caller: Caller, user_id: UUID, body: UserUpdate, expected_version: int | None
) -> Document:
    user = await get_user(db, user_id)
    changes = body.model_dump(exclude_unset=True, mode="json")
    changes = {k: v for k, v in changes.items() if user.get(k) != v}
    if not changes:
        return user

    if user_id == caller.user_id and ("role" in changes or "status" in changes):
        raise Conflict("You cannot change your own role or status", code="cannot_modify_self")
    if "role" in changes and await memberships.list_for_user(db, user_id):
        raise Conflict(
            "Remove the user from their shops before changing their role",
            code="role_change_blocked",
        )
    losing_admin = user["role"] == Role.SYSTEM_ADMIN.value and (
        changes.get("role", Role.SYSTEM_ADMIN.value) != Role.SYSTEM_ADMIN.value
        or changes.get("status", "active") != "active"
    )
    if losing_admin and await users.count_active_admins(db) <= 1:
        raise Conflict("At least one active system admin must remain", code="last_admin")

    async def write(s: Session) -> Document:
        updated = await users.update(
            db, user_id, changes, expected_version=expected_version, session=s
        )
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


async def reset_password(
    db: Database, actor: Actor, user_id: UUID, new_password: str, shop_id: UUID | None = None
) -> None:
    """Set a temporary password (the user must change it) and sign them out everywhere."""
    password_hash = hash_password(new_password)

    async def write(s: Session) -> None:
        await users.update(
            db,
            user_id,
            {
                "password_hash": password_hash,
                "must_change_password": True,
                "password_changed_at": utcnow(),
                "failed_logins": 0,
                "locked_until": None,
            },
            session=s,
        )
        await sessions.revoke_all_for_user(db, user_id, "password_reset", session=s)
        await audit.record(
            db,
            actor,
            "user.password_reset",
            entity="user",
            entity_id=user_id,
            shop_id=shop_id,
            session=s,
        )

    await in_transaction(db, write)


async def change_own_password(
    db: Database, caller: Caller, current_password: str, new_password: str
) -> None:
    user = await get_user(db, caller.user_id)
    if not verify_password(current_password, user["password_hash"]):
        raise Unprocessable("Current password is incorrect", code="invalid_current_password")
    if verify_password(new_password, user["password_hash"]):
        raise Unprocessable(
            "The new password must differ from the current one", code="password_reused"
        )
    password_hash = hash_password(new_password)

    async def write(s: Session) -> None:
        await users.update(
            db,
            caller.user_id,
            {
                "password_hash": password_hash,
                "must_change_password": False,
                "password_changed_at": utcnow(),
            },
            session=s,
        )
        # Sign out every other device; this one keeps its session.
        await sessions.revoke_all_for_user(
            db, caller.user_id, "password_changed", except_session=caller.session_id, session=s
        )
        await audit.record(
            db,
            caller.actor,
            "user.password_changed",
            entity="user",
            entity_id=caller.user_id,
            session=s,
        )

    await in_transaction(db, write)
