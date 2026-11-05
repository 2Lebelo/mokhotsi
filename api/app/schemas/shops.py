"""Shop and shop-member models."""

from datetime import datetime
from typing import Annotated, Literal, Self
from uuid import UUID

from pydantic import AfterValidator, BaseModel, Field, model_validator

from app.core.permissions import CASHIER_GRANTABLE, MemberRole, Perm
from app.schemas.auth import NewPin, Pin
from app.schemas.common import Name, StrictModel

ShopStatus = Literal["active", "suspended"]


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
    """An approved owner opens a shop. Their PIN confirms it is them and becomes their PIN in
    the new shop; the phone they are using is registered to the shop."""

    name: Name
    pin: Pin


class ShopUpdate(StrictModel):
    """Owners rename their shops; only a system admin changes the status."""

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
    invalid = sorted(p.value for p in perms if p not in CASHIER_GRANTABLE)
    if invalid:
        raise ValueError(
            f"Not grantable to a cashier: {', '.join(invalid)}. "
            f"Grantable: {', '.join(sorted(p.value for p in CASHIER_GRANTABLE))}"
        )
    return sorted(set(perms))


class MemberUser(BaseModel):
    phone: str | None = None
    name: str
    status: str


class MemberOut(BaseModel):
    user_id: UUID
    shop_id: UUID
    role: MemberRole
    granted_permissions: list[Perm]
    permissions: list[Perm]  # Effective: defaults + granted (owners: everything)
    user: MemberUser
    created_at: datetime
    updated_at: datetime
    version: int


GrantablePerms = Annotated[list[Perm], AfterValidator(_grantable)]


class MemberCreate(StrictModel):
    """Creates a new cashier account and adds it to the shop. The PIN must be unique in the shop:
    it alone identifies the cashier at the till."""

    name: Name
    pin: NewPin
    permissions: GrantablePerms = Field(default_factory=list)


class MemberUpdate(StrictModel):
    permissions: GrantablePerms


class MemberPinReset(StrictModel):
    pin: NewPin


class DataClaimOut(BaseModel):
    device_id: UUID = Field(description="The one phone whose offline data seeds this shop")
