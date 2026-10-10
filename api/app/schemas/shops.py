"""Shop and shop-member models."""

from datetime import datetime
from typing import Annotated, Literal, Self
from uuid import UUID

from pydantic import AfterValidator, BaseModel, Field, model_validator

from app.core.permissions import SITTER_GRANTABLE, MemberRole, Perm
from app.schemas.common import Email, Name, Password, StrictModel

ShopStatus = Literal["active", "archived"]


class ShopOut(BaseModel):
    id: UUID
    name: str
    owner_id: UUID
    status: ShopStatus
    created_at: datetime
    updated_at: datetime
    version: int
    # The caller's own access; null for a system admin viewing the shop.
    my_role: MemberRole | None = None
    my_permissions: list[Perm] | None = None


class ShopCreate(StrictModel):
    name: Name
    owner_id: UUID | None = None  # Admins must set it; keepers may omit it (themselves).


class ShopUpdate(StrictModel):
    name: Name | None = None
    status: ShopStatus | None = None

    @model_validator(mode="after")
    def _not_empty(self) -> Self:
        if not self.model_fields_set:
            raise ValueError("Provide at least one field to update")
        if any(getattr(self, f) is None for f in self.model_fields_set):
            raise ValueError("Fields cannot be set to null")
        return self


def _grantable(perms: list[Perm]) -> list[Perm]:
    invalid = sorted(p.value for p in perms if p not in SITTER_GRANTABLE)
    if invalid:
        raise ValueError(
            f"Not grantable to a sitter: {', '.join(invalid)}. "
            f"Grantable: {', '.join(sorted(p.value for p in SITTER_GRANTABLE))}"
        )
    return sorted(set(perms))


class MemberUser(BaseModel):
    email: str
    name: str
    status: str


class MemberOut(BaseModel):
    user_id: UUID
    shop_id: UUID
    role: MemberRole
    granted_permissions: list[Perm]
    permissions: list[Perm]  # Effective: defaults + granted (keepers: everything)
    user: MemberUser
    created_at: datetime
    updated_at: datetime
    version: int


GrantablePerms = Annotated[list[Perm], AfterValidator(_grantable)]


class MemberCreate(StrictModel):
    """Creates a new shop-sitter account and adds it to the shop."""

    email: Email
    name: Name
    password: Password
    permissions: GrantablePerms = Field(default_factory=list)


class MemberUpdate(StrictModel):
    permissions: GrantablePerms
