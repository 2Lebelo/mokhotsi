"""Audit log, role and permission models."""

from datetime import datetime
from typing import Any, Literal
from uuid import UUID

from pydantic import BaseModel

from app.core.permissions import Perm, Role


class AuditLogOut(BaseModel):
    id: UUID
    created_at: datetime
    action: str
    entity: str
    entity_id: UUID | None
    shop_id: UUID | None
    actor_id: UUID | None
    actor_role: str | None
    actor_email: str | None
    changes: dict[str, Any] | None
    metadata: dict[str, Any] | None
    request_id: str | None
    ip: str | None
    user_agent: str | None
    device_id: UUID | None


class RoleOut(BaseModel):
    name: Role
    description: str
    system_permissions: list[Perm]
    default_shop_permissions: list[Perm]
    grantable_shop_permissions: list[Perm]


class PermissionOut(BaseModel):
    name: Perm
    scope: Literal["system", "shop"]
    description: str
