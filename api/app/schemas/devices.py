"""Registered phones and the roster a phone needs to check PINs offline (ADR 0005)."""

from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, Field

from app.core.permissions import MemberRole, Perm
from app.schemas.shops import ShopStatus


class DeviceOut(BaseModel):
    id: UUID
    name: str
    platform: str
    registered_by: UUID
    shop_ids: list[UUID]
    created_at: datetime
    last_seen_at: datetime
    last_sync_at: datetime | None
    revoked_at: datetime | None


class RosterMember(BaseModel):
    user_id: UUID
    name: str
    role: MemberRole
    permissions: list[Perm] = Field(description="Effective permissions in this shop")
    pin_tag: str | None = Field(
        description="HMAC-SHA256(pin_key, PIN), hex. Null until the member's PIN is set again."
    )
    must_change_pin: bool


class RosterShop(BaseModel):
    id: UUID
    name: str
    status: ShopStatus
    roster_version: int
    pin_key: str = Field(description="Base64. Keep it in the phone's keystore, never in SQLite")
    data_claimed_by_device: UUID | None
    members: list[RosterMember] = Field(description="Active people who may sign in")


class RosterOut(BaseModel):
    device_id: UUID
    shops: list[RosterShop]
