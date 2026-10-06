"""Shop registration, login and token refresh."""

from app.core.config import Settings
from app.core.db import Database
from app.core.errors import NotImplementedFeature
from app.schemas.auth import LoginRequest, RefreshRequest, RegisterRequest, TokenResponse


async def register(db: Database, settings: Settings, body: RegisterRequest) -> TokenResponse:
    # TODO(feature): hash_password → shops.insert_shop (409 on duplicate owner_phone) →
    # devices.upsert_device → issue access + refresh tokens.
    raise NotImplementedFeature("POST /auth/register")


async def login(db: Database, settings: Settings, body: LoginRequest) -> TokenResponse:
    # TODO(feature): shops.find_by_owner_phone → verify_password (401 on mismatch, constant-time) →
    # devices.upsert_device → issue tokens.
    raise NotImplementedFeature("POST /auth/login")


async def refresh(db: Database, settings: Settings, body: RefreshRequest) -> TokenResponse:
    # TODO(feature): decode_token(…, "refresh") → issue a new pair (rotate refresh token).
    raise NotImplementedFeature("POST /auth/refresh")
