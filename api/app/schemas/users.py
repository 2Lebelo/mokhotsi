"""User models (admin user management and the caller's own profile)."""

from datetime import datetime
from typing import Literal, Self
from uuid import UUID

from pydantic import BaseModel, model_validator

from app.core.permissions import MemberRole, Perm, Role
from app.schemas.common import Email, Name, Password, StrictModel

UserStatus = Literal["active", "disabled"]


class UserOut(BaseModel):
    id: UUID
    email: str
    name: str
    role: Role
    status: UserStatus
    must_change_password: bool
    last_login_at: datetime | None
    created_at: datetime
    updated_at: datetime
    version: int


class MyMembership(BaseModel):
    shop_id: UUID
    shop_name: str
    shop_status: str
    role: MemberRole
    permissions: list[Perm]


class MeOut(UserOut):
    permissions: list[Perm]
    memberships: list[MyMembership]


class UserCreate(StrictModel):
    email: Email
    name: Name
    role: Role
    password: Password
    shop_id: UUID | None = None
    shop_name: Name | None = None

    @model_validator(mode="after")
    def _shop_fields_match_role(self) -> Self:
        if self.role is Role.SHOP_SITTER and self.shop_id is None:
            raise ValueError("shop_id is required for a shop_sitter")
        if self.role is not Role.SHOP_SITTER and self.shop_id is not None:
            raise ValueError("shop_id is only allowed for a shop_sitter")
        if self.role is not Role.SHOP_KEEPER and self.shop_name is not None:
            raise ValueError("shop_name (an initial shop) is only allowed for a shop_keeper")
        return self


class UserUpdate(StrictModel):
    name: Name | None = None
    role: Role | None = None
    status: UserStatus | None = None

    @model_validator(mode="after")
    def _not_empty(self) -> Self:
        if not self.model_fields_set:
            raise ValueError("Provide at least one field to update")
        if any(getattr(self, f) is None for f in self.model_fields_set):
            raise ValueError("Fields cannot be set to null")
        return self


class PasswordChange(StrictModel):
    current_password: str
    new_password: Password


class PasswordResetCreate(StrictModel):
    new_password: Password
