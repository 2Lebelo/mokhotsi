"""Registration, PIN and device sign-in, refresh-token rotation, logout and sessions (ADR 0005).

Every PIN attempt goes through `_check_pin`:
1. A rate limit keyed by IP + phone (or phone + shop), before any slow hashing.
2. An Argon2 verify, against a dummy hash when nobody matches, so timing reveals nothing.
3. Lockout: after `pin_max_failures` wrong PINs (`admin_pin_max_failures` for the admin) the
   account locks, each lockout lasting twice the last.

Every session is bound to a registered phone. A PIN on its own never signs anyone in.
"""

from datetime import timedelta
from uuid import UUID, uuid4

from fastapi import Request

from app.core import audit
from app.core.audit import Actor
from app.core.clock import utcnow
from app.core.config import Settings
from app.core.credentials import normalize_phone
from app.core.db import Database, Document, Session, in_transaction
from app.core.deps import Caller
from app.core.errors import Locked, NotFound, Unauthorized, Unprocessable
from app.core.pagination import PageParams, build_page_query
from app.core.permissions import Role
from app.core.ratelimit import limit_attempts, limit_subject
from app.core.request_meta import client_ip, request_id, user_agent
from app.core.security import (
    create_access_token,
    create_device_token,
    format_refresh_token,
    hash_pin,
    hash_secret,
    new_refresh_secret,
    parse_refresh_token,
    pin_tag,
    secrets_match,
    verify_pin,
    verify_pin_and_update,
)
from app.repositories import memberships, sessions, shop_secrets, users
from app.schemas.auth import (
    DeviceCredential,
    DeviceGrant,
    DevicePinGrant,
    DeviceTokenResponse,
    IssuedDevice,
    PinGrant,
    RefreshTokenGrant,
    RegistrationCreate,
    SessionOut,
    TokenResponse,
    TokenUser,
)
from app.services import device_service
from app.services.user_service import AUDITED_FIELDS as USER_FIELDS

SESSION_SORTS = {"created_at": "created_at"}
# How long the previous refresh token still works when its successor was never used.
REFRESH_RETRY_GRACE = timedelta(days=7)
_INVALID = "Wrong phone number or PIN"


def parse_phone(raw: str, settings: Settings) -> str:
    try:
        return normalize_phone(raw, settings.default_country_code)
    except ValueError as exc:
        raise Unprocessable(str(exc), code="invalid_phone") from None


def _actor_for(user: Document, request: Request, settings: Settings, device_id: UUID) -> Actor:
    return Actor(
        id=user["_id"],
        role=user["role"],
        phone=user.get("phone"),
        ip=client_ip(request),
        request_id=request_id(request),
        user_agent=user_agent(request),
        device_id=device_id,
    )


def _refresh_ttl(settings: Settings, user: Document) -> timedelta:
    if user["role"] == Role.SYSTEM_ADMIN.value:
        return timedelta(hours=settings.admin_refresh_token_ttl_hours)
    return timedelta(days=settings.refresh_token_ttl_days)


def _token_response(
    settings: Settings,
    user: Document,
    session_id: UUID,
    device_id: UUID,
    secret: str,
    issued: IssuedDevice | None = None,
) -> TokenResponse:
    access, expires_in = create_access_token(
        settings,
        user_id=user["_id"],
        role=user["role"],
        session_id=session_id,
        device_id=device_id,
    )
    return TokenResponse(
        access_token=access,
        refresh_token=format_refresh_token(session_id, secret),
        expires_in=expires_in,
        session_id=session_id,
        device_id=device_id,
        user=TokenUser(
            id=user["_id"],
            phone=user.get("phone"),
            name=user["name"],
            role=user["role"],
            status=user["status"],
            must_change_pin=user.get("must_change_pin", False),
        ),
        device=issued,
    )


def _session_doc(
    request: Request, settings: Settings, user: Document, device_id: UUID
) -> tuple[Document, str]:
    secret = new_refresh_secret()
    doc = sessions.new_session_doc(
        session_id=uuid4(),
        user_id=user["_id"],
        device_id=device_id,
        refresh_hash=hash_secret(secret),
        expires_at=utcnow() + _refresh_ttl(settings, user),
        ip=client_ip(request),
        user_agent=user_agent(request),
    )
    return doc, secret


def _ensure_unlocked(user: Document | None) -> None:
    now = utcnow()
    if user is not None and user["locked_until"] is not None and user["locked_until"] > now:
        retry_after = int((user["locked_until"] - now).total_seconds()) + 1
        raise Locked(
            "Too many wrong PINs. Try again later.", headers={"Retry-After": str(retry_after)}
        )


async def _check_pin(
    request: Request,
    db: Database,
    settings: Settings,
    user: Document | None,
    pin: str,
    *,
    attempt: Actor,
) -> Document:
    """The user if `pin` is theirs; otherwise count the failure and raise 401."""
    _ensure_unlocked(user)
    if user is not None:
        ok, upgraded = await verify_pin_and_update(pin, user["pin_hash"])
        if ok:
            if upgraded is not None:
                await users.upgrade_pin_hash(db, user["_id"], user["pin_hash"], upgraded)
            return user
    if user is None:
        await verify_pin(pin, None)  # Same work as a real check.

    is_admin = user is not None and user["role"] == Role.SYSTEM_ADMIN.value
    action = "auth.admin_login_failed" if is_admin else "auth.login_failed"
    locked_until = None
    if user is not None:
        locked_until = await users.record_pin_failure(
            db,
            user["_id"],
            settings.admin_pin_max_failures if is_admin else settings.pin_max_failures,
            timedelta(seconds=settings.pin_lockout_seconds),
            timedelta(hours=settings.pin_lockout_max_hours),
        )
    entity_id = user["_id"] if user else None
    await audit.record(db, attempt, action, entity="user", entity_id=entity_id)
    if locked_until is not None:
        await audit.record(
            db,
            attempt,
            "user.locked",
            entity="user",
            entity_id=entity_id,
            metadata={"locked_until": locked_until},
        )
    raise Unauthorized(_INVALID, code="invalid_credentials")


def _ensure_may_sign_in(user: Document) -> None:
    if user["status"] == "rejected":
        raise Unauthorized("Your registration was not approved", code="registration_rejected")
    if user["status"] not in ("active", "pending"):
        raise Unauthorized("Account is disabled", code="account_disabled")


async def _open_session(
    request: Request,
    db: Database,
    settings: Settings,
    user: Document,
    device_id: UUID,
    issued: IssuedDevice | None = None,
) -> TokenResponse:
    await users.record_login_success(db, user["_id"])
    doc, secret = _session_doc(request, settings, user, device_id)
    await sessions.insert(db, doc)
    await audit.record(
        db,
        _actor_for(user, request, settings, device_id),
        "session.created",
        entity="session",
        entity_id=doc["_id"],
    )
    return _token_response(settings, user, doc["_id"], device_id, secret, issued)


async def register(
    request: Request, db: Database, settings: Settings, body: RegistrationCreate
) -> TokenResponse:
    """An owner signs up from their phone: pending owner + registered phone + session."""
    phone = parse_phone(body.phone, settings)
    await limit_attempts(
        request, "register", "any", settings.rate_limit_register_per_hour, 3_600_000
    )
    user = users.new_user_doc(
        name=body.name,
        role=Role.OWNER,
        pin_hash=await hash_pin(body.pin),  # Outside the transaction: it may be retried.
        phone=phone,
        status="pending",
        created_by=None,
    )
    device, device_secret = device_service.new_device(
        user["_id"], body.device.name, body.device.platform
    )
    actor = _actor_for(user, request, settings, device["_id"])

    async def write(s: Session) -> None:
        await users.insert(db, user, s)
        await audit.record(
            db,
            actor,
            "user.registered",
            entity="user",
            entity_id=user["_id"],
            changes=audit.snapshot(user, USER_FIELDS),
            session=s,
        )
        await device_service.insert_device(db, actor, device, s)

    await in_transaction(db, write)
    issued = IssuedDevice(device_id=device["_id"], device_secret=device_secret)
    return await _open_session(request, db, settings, user, device["_id"], issued)


async def sign_in_with_pin(
    request: Request, db: Database, settings: Settings, body: PinGrant
) -> TokenResponse:
    """Phone + PIN on any phone (owners and admins)."""
    phone = parse_phone(body.phone, settings)
    await limit_attempts(request, "pin", phone, settings.rate_limit_login_per_minute)
    found = await users.find_by_phone(db, phone)
    user = await _check_pin(
        request,
        db,
        settings,
        found,
        body.pin,
        attempt=Actor.anonymous(request, settings, phone=phone),
    )
    _ensure_may_sign_in(user)

    if isinstance(body.device, DeviceCredential):
        device = await device_service.authenticate(
            db, body.device.device_id, body.device.device_secret
        )
        return await _open_session(request, db, settings, user, device["_id"])

    device, device_secret = device_service.new_device(
        user["_id"], body.device.name, body.device.platform
    )
    actor = _actor_for(user, request, settings, device["_id"])
    await in_transaction(db, lambda s: device_service.insert_device(db, actor, device, s))
    issued = IssuedDevice(device_id=device["_id"], device_secret=device_secret)
    return await _open_session(request, db, settings, user, device["_id"], issued)


async def sign_in_on_device(
    request: Request, db: Database, settings: Settings, body: DevicePinGrant
) -> TokenResponse:
    """PIN on a phone registered to the shop: the PIN tag says who it is (cashiers too)."""
    await limit_attempts(
        request, "device-pin", f"{body.device_id}", settings.rate_limit_login_per_minute
    )
    # A wrong PIN matches nobody, so no account locks; this caps guesses from a stolen phone
    # however many networks it uses. The owner revokes the phone to stop it entirely.
    await limit_subject(request, "device-pin", f"{body.device_id}", 20, 3_600_000)
    device = await device_service.authenticate(db, body.device_id, body.device_secret)
    attempt = Actor.anonymous(request, settings)
    key = await shop_secrets.get_key(db, body.shop_id)
    membership = None
    if key is not None and body.shop_id in device["shop_ids"]:
        membership = await memberships.find_by_tag(db, body.shop_id, pin_tag(key, body.pin))
    found = await users.get(db, membership["user_id"]) if membership else None
    user = await _check_pin(request, db, settings, found, body.pin, attempt=attempt)
    _ensure_may_sign_in(user)
    return await _open_session(request, db, settings, user, device["_id"])


async def device_token(db: Database, settings: Settings, body: DeviceGrant) -> DeviceTokenResponse:
    device = await device_service.authenticate(db, body.device_id, body.device_secret)
    token, expires_in = create_device_token(settings, device["_id"])
    return DeviceTokenResponse(access_token=token, expires_in=expires_in, device_id=device["_id"])


async def refresh(
    request: Request, db: Database, settings: Settings, body: RefreshTokenGrant
) -> TokenResponse:
    session_id, secret = parse_refresh_token(body.refresh_token)
    session = await sessions.get(db, session_id)
    if session is None or session["revoked_at"] is not None or session["expires_at"] <= utcnow():
        raise Unauthorized("Invalid or expired refresh token", code="invalid_token")

    user = await users.get(db, session["user_id"])
    if user is None:
        raise Unauthorized("Account is disabled", code="account_disabled")
    _ensure_may_sign_in(user)
    actor = _actor_for(user, request, settings, session["device_id"])

    now = utcnow()
    new_secret = new_refresh_secret()
    rotate_args = (
        db,
        session_id,
        session["refresh_hash"],
        hash_secret(new_secret),
        client_ip(request),
        now + _refresh_ttl(settings, user),
    )
    rotated = False
    if secrets_match(secret, session["refresh_hash"]):
        rotated = await sessions.rotate(
            *rotate_args,
            prev_hash=session["refresh_hash"],
            prev_valid_until=now + REFRESH_RETRY_GRACE,
        )
    elif (
        session.get("prev_refresh_hash")
        and session["prev_valid_until"] > now
        and secrets_match(secret, session["prev_refresh_hash"])
    ):
        # The phone never received the last rotation (response lost on a bad network) and
        # retried with the token it still holds. Its successor was never used, so rotate again
        # and keep remembering this token until the phone uses what it gets back.
        rotated = await sessions.rotate(
            *rotate_args,
            prev_hash=session["prev_refresh_hash"],
            prev_valid_until=session["prev_valid_until"],
            expect_prev=session["prev_refresh_hash"],
        )
    if not rotated:
        # An old (already rotated) token was replayed: assume it leaked and kill the session.
        await sessions.revoke(db, session_id, "refresh_token_reuse")
        await audit.record(
            db, actor, "session.reuse_detected", entity="session", entity_id=session_id
        )
        raise Unauthorized("Refresh token was already used", code="refresh_token_reused")

    return _token_response(settings, user, session_id, session["device_id"], new_secret)


async def logout(db: Database, caller: Caller) -> None:
    await sessions.revoke(db, caller.session_id, "logout")
    await audit.record(
        db, caller.actor, "session.revoked", entity="session", entity_id=caller.session_id
    )


async def revoke_session(db: Database, caller: Caller, session_id: UUID) -> None:
    session = await sessions.get(db, session_id)
    if session is None or session["user_id"] != caller.user_id:
        raise NotFound("Session not found")
    if await sessions.revoke(db, session_id, "revoked_by_user"):
        await audit.record(
            db, caller.actor, "session.revoked", entity="session", entity_id=session_id
        )


async def list_sessions(
    db: Database, caller: Caller, params: PageParams, active: bool | None
) -> tuple[list[SessionOut], str | None]:
    base: Document = {"user_id": caller.user_id}
    if active is True:
        base["revoked_at"] = None
    elif active is False:
        base["revoked_at"] = {"$ne": None}
    query = build_page_query(params, base, SESSION_SORTS, "-created_at")
    docs, next_cursor = query.finish(await sessions.list_page(db, query))
    return [
        SessionOut(
            id=d["_id"],
            device_id=d.get("device_id"),
            current=d["_id"] == caller.session_id,
            created_at=d["created_at"],
            last_used_at=d["last_used_at"],
            expires_at=d["expires_at"],
            revoked_at=d["revoked_at"],
            ip=d.get("ip"),
            user_agent=d.get("user_agent"),
        )
        for d in docs
    ], next_cursor
