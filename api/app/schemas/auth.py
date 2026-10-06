"""Auth request/response models (not part of the sync contract)."""

from typing import Annotated, Literal
from uuid import UUID

from pydantic import Field

from app.schemas.common import StrictModel

Phone = Annotated[str, Field(min_length=6, max_length=20, pattern=r"^\+?[0-9]+$")]
Password = Annotated[str, Field(min_length=8, max_length=128)]


class RegisterRequest(StrictModel):
    shop_name: Annotated[str, Field(min_length=1, max_length=120)]
    owner_phone: Phone
    password: Password
    device_id: UUID


class LoginRequest(StrictModel):
    owner_phone: Phone
    password: Password
    device_id: UUID


class RefreshRequest(StrictModel):
    refresh_token: str


class TokenResponse(StrictModel):
    access_token: str
    refresh_token: str
    token_type: Literal["bearer"] = "bearer"  # noqa: S105 — OAuth2 token type, not a secret
    expires_in: int = Field(description="Access-token lifetime in seconds")
    shop_id: UUID
