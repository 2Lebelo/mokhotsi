"""Registration, token grants and session models (ADR 0005).

Grants on POST /tokens:
- `pin`: phone + PIN, for owners and admins on any phone. Registers the phone if it sends no
  device credential.
- `device_pin`: a registered phone + shop + PIN, for anyone in that shop (cashiers have no
  phone number; the PIN identifies them within the shop).
- `device`: a registered phone's own credential, for sync and the roster (nobody signed in).
- `refresh_token`: rotate a session's refresh token.
"""

from datetime import datetime
from typing import Annotated, Literal
from uuid import UUID

from pydantic import AfterValidator, BaseModel, Field, StringConstraints

from app.core.credentials import PIN_LENGTH, check_pin
from app.core.permissions import Role
from app.schemas.common import Name, StrictModel

UserStatus = Literal["pending", "active", "rejected", "disabled"]


def _new_pin(pin: str) -> str:
    check_pin(pin)
    return pin


# Sign-in accepts any 5 digits so a stricter PIN policy never locks anyone out.
Pin = Annotated[str, Field(pattern=rf"^\d{{{PIN_LENGTH}}}$", examples=["40817"])]
NewPin = Annotated[Pin, AfterValidator(_new_pin)]
# Normalised to E.164 by the service (the default country code is a setting).
Phone = Annotated[
    str,
    StringConstraints(strip_whitespace=True, min_length=6, max_length=24),
    Field(examples=["+266 5812 3456"]),
]
DeviceSecret = Annotated[str, Field(min_length=20, max_length=128)]
DeviceName = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=60)]


class DeviceCredential(StrictModel):
    """A phone registered earlier."""

    device_id: UUID
    device_secret: DeviceSecret


class NewDevice(StrictModel):
    """A phone signing in for the first time: it is registered and gets a credential."""

    name: DeviceName = Field(examples=["Counter phone"])
    platform: Literal["android", "ios"]


class RegistrationCreate(StrictModel):
    """A shop owner signs up. They can sign in at once but do nothing until approved."""

    name: Name
    phone: Phone
    pin: NewPin
    device: NewDevice


class PinGrant(StrictModel):
    grant_type: Literal["pin"]
    phone: Phone
    pin: Pin
    device: DeviceCredential | NewDevice


class DevicePinGrant(StrictModel):
    grant_type: Literal["device_pin"]
    device_id: UUID
    device_secret: DeviceSecret
    shop_id: UUID
    pin: Pin


class DeviceGrant(StrictModel):
    grant_type: Literal["device"]
    device_id: UUID
    device_secret: DeviceSecret


class RefreshTokenGrant(StrictModel):
    grant_type: Literal["refresh_token"]
    refresh_token: Annotated[str, Field(min_length=1, max_length=512)]


TokenRequest = Annotated[
    PinGrant | DevicePinGrant | DeviceGrant | RefreshTokenGrant,
    Field(discriminator="grant_type"),
]


class TokenUser(BaseModel):
    id: UUID
    phone: str | None
    name: str
    role: Role
    status: UserStatus
    must_change_pin: bool


class IssuedDevice(BaseModel):
    """Returned once, when a phone is registered. Store the secret in the phone's keystore."""

    device_id: UUID
    device_secret: str


class TokenResponse(BaseModel):
    access_token: str
    refresh_token: str = Field(description="Single use: every refresh returns a new one")
    token_type: Literal["bearer"] = "bearer"  # noqa: S105 — OAuth2 token type, not a secret
    expires_in: int = Field(description="Access-token lifetime in seconds")
    session_id: UUID
    device_id: UUID
    user: TokenUser
    device: IssuedDevice | None = Field(
        default=None, description="Only when this request registered the phone"
    )


class DeviceTokenResponse(BaseModel):
    access_token: str
    token_type: Literal["bearer"] = "bearer"  # noqa: S105
    expires_in: int
    device_id: UUID


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
