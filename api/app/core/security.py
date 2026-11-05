"""PIN hashing (pwdlib, Argon2), PIN tags, access and device JWTs (PyJWT), opaque secrets.

- PIN hash: Argon2id (19 MiB, t=2, p=1: the OWASP minimum), verified on the server for every
  online sign-in. Hashing is deliberately slow, so it runs in a worker thread (on the event loop
  it would stall every other request), and at most `_HASH_SLOTS` run at once so a burst of
  sign-ins cannot exhaust memory. Older, costlier hashes are upgraded at the next sign-in.
- PIN tag: HMAC-SHA256(shop pin_key, pin). It identifies a member within one shop (unique per
  shop) and lets a registered phone check PINs offline. Useless without the shop's key.
- Access token: short-lived HS256 JWT (`typ=access`) for a signed-in person. Every request
  still checks the session and user in the database, so revocation takes effect immediately.
- Device token: short-lived HS256 JWT (`typ=device`) for a registered phone, used by sync and
  the roster. Every request reloads the device, so a revoked phone is refused at once.
- Refresh token: opaque `<session_id>.<secret>`; only sha256(secret) is stored. It rotates on
  every use; presenting an old secret revokes the whole session (reuse detection), except the
  immediately previous one while its successor is unused (a retry after a lost response).
- Device secret: 256 random bits, given to the phone once; only sha256(secret) is stored.
"""

import hashlib
import hmac
import secrets
from dataclasses import dataclass
from datetime import timedelta
from typing import Any, Literal
from uuid import UUID, uuid4

import jwt
from anyio import CapacityLimiter, to_thread
from pwdlib import PasswordHash
from pwdlib.hashers.argon2 import Argon2Hasher

from app.core.clock import utcnow
from app.core.config import Settings
from app.core.errors import Unauthorized

ISSUER = "mokhotsi"
AUDIENCE = "mokhotsi-api"

_hasher = PasswordHash((Argon2Hasher(time_cost=2, memory_cost=19_456, parallelism=1),))
# Each hash holds its memory cost for its whole run; this bounds the total (~80 MiB).
_HASH_SLOTS = CapacityLimiter(4)
# Verified against when the phone is unknown, so response time does not reveal who exists.
_DUMMY_HASH = _hasher.hash("00000-not-a-real-pin")


async def hash_pin(pin: str) -> str:
    return await to_thread.run_sync(_hasher.hash, pin, limiter=_HASH_SLOTS)


def _verify(pin: str, pin_hash: str | None) -> tuple[bool, str | None]:
    if pin_hash is None:
        _hasher.verify(pin, _DUMMY_HASH)
        return False, None
    return _hasher.verify_and_update(pin, pin_hash)


async def verify_pin(pin: str, pin_hash: str | None) -> bool:
    """Constant work whether or not the user exists (pass None for an unknown user)."""
    ok, _ = await verify_pin_and_update(pin, pin_hash)
    return ok


async def verify_pin_and_update(pin: str, pin_hash: str | None) -> tuple[bool, str | None]:
    """Like `verify_pin`, plus a fresh hash when the stored one uses outdated parameters."""
    return await to_thread.run_sync(_verify, pin, pin_hash, limiter=_HASH_SLOTS)


def new_pin_key() -> bytes:
    return secrets.token_bytes(32)


def pin_tag(pin_key: bytes, pin: str) -> str:
    return hmac.new(pin_key, pin.encode(), hashlib.sha256).hexdigest()


@dataclass(frozen=True, slots=True)
class AccessClaims:
    sub: UUID  # user id
    role: str
    sid: UUID  # session id
    device_id: UUID | None


@dataclass(frozen=True, slots=True)
class DeviceClaims:
    sub: UUID  # device id


def _encode(settings: Settings, claims: dict[str, Any], ttl: timedelta) -> tuple[str, int]:
    now = utcnow()
    payload = {
        "iss": ISSUER,
        "aud": AUDIENCE,
        "jti": uuid4().hex,
        "iat": now,
        "exp": now + ttl,
        **claims,
    }
    token = jwt.encode(payload, settings.jwt_secret.get_secret_value(), settings.jwt_algorithm)
    return token, int(ttl.total_seconds())


def _decode(
    settings: Settings, token: str, typ: Literal["access", "device"], required: list[str]
) -> dict[str, Any]:
    claims = jwt.decode(
        token,
        settings.jwt_secret.get_secret_value(),
        algorithms=[settings.jwt_algorithm],
        audience=AUDIENCE,
        issuer=ISSUER,
        options={"require": ["exp", "iat", "sub", "typ", *required]},
    )
    if claims["typ"] != typ:
        raise jwt.InvalidTokenError(f"not a {typ} token")
    return claims


def create_access_token(
    settings: Settings, *, user_id: UUID, role: str, session_id: UUID, device_id: UUID | None
) -> tuple[str, int]:
    """Return (token, lifetime in seconds)."""
    return _encode(
        settings,
        {
            "sub": str(user_id),
            "role": role,
            "sid": str(session_id),
            "did": str(device_id) if device_id else None,
            "typ": "access",
        },
        timedelta(minutes=settings.access_token_ttl_minutes),
    )


def decode_access_token(settings: Settings, token: str) -> AccessClaims:
    try:
        claims = _decode(settings, token, "access", ["sid"])
        return AccessClaims(
            sub=UUID(claims["sub"]),
            role=str(claims["role"]),
            sid=UUID(claims["sid"]),
            device_id=UUID(claims["did"]) if claims.get("did") else None,
        )
    except (jwt.PyJWTError, KeyError, ValueError) as exc:
        raise Unauthorized("Invalid or expired access token", code="invalid_token") from exc


def create_device_token(settings: Settings, device_id: UUID) -> tuple[str, int]:
    return _encode(
        settings,
        {"sub": str(device_id), "typ": "device"},
        timedelta(minutes=settings.device_token_ttl_minutes),
    )


def decode_device_token(settings: Settings, token: str) -> DeviceClaims:
    try:
        return DeviceClaims(sub=UUID(_decode(settings, token, "device", [])["sub"]))
    except (jwt.PyJWTError, KeyError, ValueError) as exc:
        raise Unauthorized("Invalid or expired device token", code="invalid_token") from exc


def hash_secret(secret: str) -> str:
    return hashlib.sha256(secret.encode()).hexdigest()


def new_refresh_secret() -> str:
    return secrets.token_urlsafe(48)


def new_device_secret() -> str:
    return secrets.token_urlsafe(32)


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
