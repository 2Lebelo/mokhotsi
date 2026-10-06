"""Password hashing (pwdlib, Argon2) and JWTs (PyJWT). All stubs for now.

Intended building blocks (verified APIs):
- `pwdlib.PasswordHash.recommended()` → `.hash(password)`, `.verify(password, hash)`;
- `jwt.encode(claims, secret, algorithm="HS256")`, `jwt.decode(token, secret, algorithms=["HS256"])`.
"""

from dataclasses import dataclass
from datetime import datetime
from typing import Literal
from uuid import UUID

from app.core.config import Settings
from app.core.errors import NotImplementedFeature

type TokenType = Literal["access", "refresh"]


@dataclass(frozen=True, slots=True)
class TokenClaims:
    """Claims carried by our JWTs. `sub` is the shop id; `shop_id` is never taken from a request body."""

    sub: UUID
    device_id: UUID
    type: TokenType
    exp: datetime


def hash_password(password: str) -> str:
    # TODO(feature): return PasswordHash.recommended().hash(password) (module-level instance).
    raise NotImplementedFeature("security.hash_password")


def verify_password(password: str, password_hash: str) -> bool:
    # TODO(feature): return PasswordHash.recommended().verify(password, password_hash).
    raise NotImplementedFeature("security.verify_password")


def create_token(settings: Settings, shop_id: UUID, device_id: UUID, token_type: TokenType) -> str:
    # TODO(feature): jwt.encode({sub, device_id, type, iat, exp}) with access/refresh TTLs from settings.
    raise NotImplementedFeature("security.create_token")


def decode_token(settings: Settings, token: str, expected_type: TokenType) -> TokenClaims:
    # TODO(feature): jwt.decode(token, secret, algorithms=[alg]); check `type`; Unauthorized on any error.
    raise NotImplementedFeature("security.decode_token")
