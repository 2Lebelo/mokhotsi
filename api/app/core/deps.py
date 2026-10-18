"""FastAPI dependencies shared by routers: database, settings, the caller and authorization.

Authentication: `Authorization: Bearer <access token>`. The JWT proves who the caller is; the
session and user are then loaded on every request, so logout, deactivation and role changes
apply immediately (the role comes from the database, never from the token).

Authorization:
- `require_permission(Perm.X)`: a system permission from the caller's role.
- `require_shop_permission(Perm.X)`: resolves `{shop_id}` from the path against the caller's
  membership. Non-members get 404 (never 403), so shop ids cannot be probed.
"""

from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from typing import Annotated
from uuid import UUID

from fastapi import Depends, Header, Request
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from app.core.audit import Actor
from app.core.clock import utcnow
from app.core.config import Settings
from app.core.db import Database
from app.core.errors import AppError, Forbidden, NotFound, Unauthorized
from app.core.permissions import (
    ADMIN_SHOP_OVERSIGHT,
    SYSTEM_PERMISSIONS,
    MemberRole,
    Perm,
    Role,
    shop_permissions,
)
from app.core.request_meta import client_ip, request_id, user_agent
from app.core.security import decode_access_token
from app.repositories import memberships, sessions, shops, users


def get_db(request: Request) -> Database:
    """The database handle created once in the lifespan (one client per process)."""
    return request.app.state.db


def get_app_settings(request: Request) -> Settings:
    """The settings this app was created with (not the global default), so tests can override."""
    return request.app.state.settings


DbDep = Annotated[Database, Depends(get_db)]
SettingsDep = Annotated[Settings, Depends(get_app_settings)]

_bearer = HTTPBearer(auto_error=False, description="Access token from POST /api/v1/tokens")


@dataclass(frozen=True, slots=True)
class Caller:
    user_id: UUID
    email: str
    name: str
    role: Role
    session_id: UUID
    device_id: UUID | None
    must_change_password: bool
    permissions: frozenset[Perm]
    ip: str
    request_id: str | None
    user_agent: str | None

    def has(self, perm: Perm) -> bool:
        return perm in self.permissions

    @property
    def actor(self) -> Actor:
        return Actor(
            id=self.user_id,
            role=self.role.value,
            email=self.email,
            ip=self.ip,
            request_id=self.request_id,
            user_agent=self.user_agent,
            device_id=self.device_id,
        )


async def _authenticate(
    request: Request,
    db: DbDep,
    credentials: Annotated[HTTPAuthorizationCredentials | None, Depends(_bearer)],
) -> Caller:
    settings: Settings = request.app.state.settings
    if credentials is None:
        raise Unauthorized()
    claims = decode_access_token(settings, credentials.credentials)
    session = await sessions.get(db, claims.sid)
    if (
        session is None
        or session["user_id"] != claims.sub
        or session["revoked_at"] is not None
        or session["expires_at"] <= utcnow()
    ):
        raise Unauthorized("Session expired or revoked", code="session_revoked")
    user = await users.get(db, claims.sub)
    if user is None or user["status"] != "active":
        raise Unauthorized("Account is disabled", code="account_disabled")
    request.state.user_id = str(user["_id"])  # Picked up by the access log.
    role = Role(user["role"])
    return Caller(
        user_id=user["_id"],
        email=user["email"],
        name=user["name"],
        role=role,
        session_id=session["_id"],
        device_id=session.get("device_id"),
        must_change_password=user["must_change_password"],
        permissions=SYSTEM_PERMISSIONS[role],
        ip=client_ip(request, settings),
        request_id=request_id(request),
        user_agent=user_agent(request),
    )


async def get_current_user_pending(caller: Annotated[Caller, Depends(_authenticate)]) -> Caller:
    """Any signed-in user, including one who still has to replace a temporary password."""
    return caller


async def get_current_user(caller: Annotated[Caller, Depends(_authenticate)]) -> Caller:
    """A signed-in user who has set their own password."""
    if caller.must_change_password:
        raise Forbidden(
            "Change your temporary password first (PUT /api/v1/users/me/password)",
            code="password_change_required",
        )
    return caller


PendingCallerDep = Annotated[Caller, Depends(get_current_user_pending)]
CallerDep = Annotated[Caller, Depends(get_current_user)]


def require_permission(perm: Perm) -> Callable[..., Awaitable[Caller]]:
    async def dependency(caller: CallerDep) -> Caller:
        if not caller.has(perm):
            raise Forbidden("You do not have permission to do this", code="permission_denied")
        return caller

    return dependency


@dataclass(frozen=True, slots=True)
class ShopAccess:
    caller: Caller
    shop: dict
    member_role: MemberRole | None  # None = system admin oversight, not a member
    permissions: frozenset[Perm]

    @property
    def shop_id(self) -> UUID:
        return self.shop["_id"]

    def has(self, perm: Perm) -> bool:
        return perm in self.permissions


def require_shop_permission(perm: Perm) -> Callable[..., Awaitable[ShopAccess]]:
    async def dependency(shop_id: UUID, caller: CallerDep, db: DbDep) -> ShopAccess:
        shop = await shops.get(db, shop_id)
        if shop is None:
            raise NotFound("Shop not found")
        membership = await memberships.get(db, caller.user_id, shop_id)
        if membership is None:
            if caller.has(Perm.SHOPS_READ_ALL) and perm in ADMIN_SHOP_OVERSIGHT:
                return ShopAccess(caller, shop, None, ADMIN_SHOP_OVERSIGHT)
            raise NotFound("Shop not found")
        role = MemberRole(membership["role"])
        granted = shop_permissions(role, membership["permissions"])
        if perm not in granted:
            raise Forbidden("You do not have permission to do this", code="permission_denied")
        return ShopAccess(caller, shop, role, granted)

    return dependency


def if_match_version(
    if_match: Annotated[
        str | None,
        Header(description='ETag from a previous GET (e.g. `"3"`); stale versions get 412'),
    ] = None,
) -> int | None:
    """Parse `If-Match: "<version>"` (weak `W/` prefix tolerated)."""
    if if_match is None or if_match.strip() == "*":
        return None
    value = if_match.strip().removeprefix("W/").strip('"')
    try:
        return int(value)
    except ValueError as exc:
        raise AppError("If-Match must be an ETag from this API", code="invalid_if_match") from exc


IfMatchDep = Annotated[int | None, Depends(if_match_version)]


def etag(version: int) -> str:
    return f'"{version}"'
