"""User models (admin user management and the caller's own account)."""

from datetime import datetime
from typing import Annotated, Literal, Self
from uuid import UUID

from pydantic import BaseModel, Field, StringConstraints, model_validator

from app.core.permissions import MemberRole, Perm, Role
from app.schemas.auth import NewPin, Phone, Pin, UserStatus
from app.schemas.common import Name, StrictModel


class UserOut(BaseModel):
    id: UUID
    phone: str | None
    name: str
    role: Role
    status: UserStatus
    must_change_pin: bool
    last_login_at: datetime | None
    reviewed_at: datetime | None = None
    review_note: str | None = None
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
    permissions: list[Perm]  # Empty until an owner is approved.
    memberships: list[MyMembership]


class UserCreate(StrictModel):
    """An admin adds an owner or another admin directly (already approved).

    The response carries a temporary PIN to pass on; it must be changed at first sign-in.
    Cashiers are created by their shop's owner (POST /shops/{id}/members).
    """

    name: Name
    phone: Phone
    role: Literal[Role.OWNER, Role.SYSTEM_ADMIN]


class UserCreated(BaseModel):
    user: UserOut
    temporary_pin: str = Field(description="Shown once. The user must change it at sign-in.")


class UserUpdate(StrictModel):
    name: Name | None = None
    status: Literal["active", "disabled"] | None = None

    @model_validator(mode="after")
    def _not_empty(self) -> Self:
        if not self.model_fields_set:
            raise ValueError("Provide at least one field to update")
        if any(getattr(self, f) is None for f in self.model_fields_set):
            raise ValueError("Fields cannot be set to null")
        return self


ReviewNote = Annotated[str, StringConstraints(strip_whitespace=True, max_length=500)]


class ReviewCreate(StrictModel):
    """The admin's decision on a pending owner. A rejection should say why."""

    decision: Literal["approve", "reject"]
    note: ReviewNote | None = None


class PinChange(StrictModel):
    current_pin: Pin
    new_pin: NewPin


class PinResetOut(BaseModel):
    temporary_pin: str = Field(description="Shown once. Pass it on; it must be changed at sign-in.")
