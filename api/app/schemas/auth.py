"""Token (login/refresh) and session models."""

from datetime import datetime
from typing import Annotated, Literal
from uuid import UUID

from pydantic import BaseModel, Field

from app.core.permissions import Role
from app.schemas.common import Email, StrictModel


class PasswordGrant(StrictModel):
    grant_type: Literal["password"]
    email: Email
    password: Annotated[str, Field(min_length=1, max_length=128)]
    device_id: UUID | None = Field(
        default=None, description="Stable id of the signing-in device (client-generated)"
    )


class RefreshTokenGrant(StrictModel):
    grant_type: Literal["refresh_token"]
    refresh_token: Annotated[str, Field(min_length=1, max_length=512)]


TokenRequest = Annotated[PasswordGrant | RefreshTokenGrant, Field(discriminator="grant_type")]


class TokenUser(BaseModel):
    id: UUID
    email: str
    name: str
    role: Role
    must_change_password: bool


class TokenResponse(BaseModel):
    access_token: str
    refresh_token: str = Field(description="Single use: every refresh returns a new one")
    token_type: Literal["bearer"] = "bearer"  # noqa: S105 — OAuth2 token type, not a secret
    expires_in: int = Field(description="Access-token lifetime in seconds")
    session_id: UUID
    user: TokenUser


class SessionOut(BaseModel):
    id: UUID
    device_id: UUID | None
    current: bool
    created_at: datetime
    last_used_at: datetime
    expires_at: datetime
    revoked_at: datetime | None
    ip: str | None
    user_agent: str | None
