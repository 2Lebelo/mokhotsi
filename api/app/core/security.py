"""Password hashing (pwdlib, Argon2), access JWTs (PyJWT) and opaque refresh tokens.

- Access token: short-lived HS256 JWT. Every request still checks the session and user in the
  database, so revocation (logout, disable, password change) takes effect immediately.
- Refresh token: opaque `<session_id>.<secret>`; only sha256(secret) is stored. It rotates on
  every use; presenting an old secret revokes the whole session (reuse detection).
"""

import hashlib
import hmac
import secrets
from dataclasses import dataclass
from datetime import timedelta
from typing import Any
from uuid import UUID, uuid4

import jwt
from pwdlib import PasswordHash

from app.core.clock import utcnow
from app.core.config import Settings
from app.core.errors import Unauthorized

ISSUER = "mokhotsi"
AUDIENCE = "mokhotsi-api"

_hasher = PasswordHash.recommended()
# Verified against when the email is unknown, so response time does not reveal which emails exist.
_DUMMY_HASH = _hasher.hash("not-a-real-password-just-burning-time")


def hash_password(password: str) -> str:
    return _hasher.hash(password)


def verify_password(password: str, password_hash: str | None) -> bool:
    if password_hash is None:
        _hasher.verify(password, _DUMMY_HASH)
        return False
    return _hasher.verify(password, password_hash)


@dataclass(frozen=True, slots=True)
class AccessClaims:
    sub: UUID  # user id
    role: str
    sid: UUID  # session id
    device_id: UUID | None


def create_access_token(
    settings: Settings, *, user_id: UUID, role: str, session_id: UUID, device_id: UUID | None
) -> tuple[str, int]:
    """Return (token, lifetime in seconds)."""
    ttl = timedelta(minutes=settings.access_token_ttl_minutes)
    now = utcnow()
    claims: dict[str, Any] = {
        "iss": ISSUER,
        "aud": AUDIENCE,
        "sub": str(user_id),
        "role": role,
        "sid": str(session_id),
        "did": str(device_id) if device_id else None,
        "typ": "access",
        "jti": uuid4().hex,
        "iat": now,
        "exp": now + ttl,
    }
    token = jwt.encode(claims, settings.jwt_secret.get_secret_value(), settings.jwt_algorithm)
    return token, int(ttl.total_seconds())


def decode_access_token(settings: Settings, token: str) -> AccessClaims:
    try:
        claims = jwt.decode(
            token,
            settings.jwt_secret.get_secret_value(),
            algorithms=[settings.jwt_algorithm],
            audience=AUDIENCE,
            issuer=ISSUER,
            options={"require": ["exp", "iat", "sub", "sid", "typ"]},
        )
        if claims["typ"] != "access":
            raise jwt.InvalidTokenError("not an access token")
        return AccessClaims(
            sub=UUID(claims["sub"]),
            role=str(claims["role"]),
            sid=UUID(claims["sid"]),
            device_id=UUID(claims["did"]) if claims.get("did") else None,
        )
    except (jwt.PyJWTError, KeyError, ValueError) as exc:
        raise Unauthorized("Invalid or expired access token", code="invalid_token") from exc


def hash_secret(secret: str) -> str:
    return hashlib.sha256(secret.encode()).hexdigest()


def new_refresh_secret() -> str:
    return secrets.token_urlsafe(48)


def format_refresh_token(session_id: UUID, secret: str) -> str:
    return f"{session_id}.{secret}"


def parse_refresh_token(token: str) -> tuple[UUID, str]:
    session_part, _, secret = token.partition(".")
    try:
        session_id = UUID(session_part)
    except ValueError as exc:
        raise Unauthorized("Invalid refresh token", code="invalid_token") from exc
    if not secret:
        raise Unauthorized("Invalid refresh token", code="invalid_token")
    return session_id, secret


def secrets_match(secret: str, expected_hash: str) -> bool:
    return hmac.compare_digest(hash_secret(secret), expected_hash)
