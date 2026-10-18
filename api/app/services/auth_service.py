"""Password login, refresh-token rotation, logout and session management."""

from datetime import timedelta
from uuid import UUID, uuid4

from fastapi import Request

from app.core import audit
from app.core.audit import Actor
from app.core.clock import utcnow
from app.core.config import Settings
from app.core.db import Database, Document
from app.core.deps import Caller
from app.core.errors import Locked, NotFound, Unauthorized
from app.core.pagination import PageParams, build_page_query
from app.core.ratelimit import limit_login
from app.core.request_meta import client_ip, request_id, user_agent
from app.core.security import (
    create_access_token,
    format_refresh_token,
    hash_secret,
    new_refresh_secret,
    parse_refresh_token,
    secrets_match,
    verify_password,
)
from app.repositories import sessions, users
from app.schemas.auth import PasswordGrant, RefreshTokenGrant, SessionOut, TokenResponse, TokenUser

SESSION_SORTS = {"created_at": "created_at"}


def _actor_for(
    user: Document, request: Request, settings: Settings, device_id: UUID | None
) -> Actor:
    return Actor(
        id=user["_id"],
        role=user["role"],
        email=user["email"],
        ip=client_ip(request, settings),
        request_id=request_id(request),
        user_agent=user_agent(request),
        device_id=device_id,
    )


def _token_response(
    settings: Settings, user: Document, session_id: UUID, device_id: UUID | None, secret: str
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
        user=TokenUser(
            id=user["_id"],
            email=user["email"],
            name=user["name"],
            role=user["role"],
            must_change_password=user["must_change_password"],
        ),
    )


async def login(
    request: Request, db: Database, settings: Settings, body: PasswordGrant
) -> TokenResponse:
    email = str(body.email).lower()
    await limit_login(request, email)
    user = await users.find_by_email(db, email)
    now = utcnow()

    if user is not None and user["locked_until"] is not None and user["locked_until"] > now:
        retry_after = int((user["locked_until"] - now).total_seconds()) + 1
        raise Locked(
            "Too many failed logins. Try again later.", headers={"Retry-After": str(retry_after)}
        )

    if user is None or not verify_password(body.password, user["password_hash"] if user else None):
        anon = Actor.anonymous(request, settings, email=email)
        locked_until = None
        if user is not None:
            locked_until = await users.record_login_failure(
                db,
                user["_id"],
                settings.login_max_failures,
                timedelta(minutes=settings.login_lockout_minutes),
            )
        await audit.record(
            db, anon, "auth.login_failed", entity="user", entity_id=user["_id"] if user else None
        )
        if locked_until is not None:
            await audit.record(
                db,
                anon,
                "user.locked",
                entity="user",
                entity_id=user["_id"] if user else None,
                metadata={"locked_until": locked_until},
            )
        raise Unauthorized("Invalid email or password", code="invalid_credentials")

    if user["status"] != "active":
        raise Unauthorized("Account is disabled", code="account_disabled")

    await users.record_login_success(db, user["_id"])
    session_id, secret = uuid4(), new_refresh_secret()
    await sessions.insert(
        db,
        sessions.new_session_doc(
            session_id=session_id,
            user_id=user["_id"],
            device_id=body.device_id,
            refresh_hash=hash_secret(secret),
            expires_at=now + timedelta(days=settings.refresh_token_ttl_days),
            ip=client_ip(request, settings),
            user_agent=user_agent(request),
        ),
    )
    await audit.record(
        db,
        _actor_for(user, request, settings, body.device_id),
        "session.created",
        entity="session",
        entity_id=session_id,
    )
    return _token_response(settings, user, session_id, body.device_id, secret)


async def refresh(
    request: Request, db: Database, settings: Settings, body: RefreshTokenGrant
) -> TokenResponse:
    session_id, secret = parse_refresh_token(body.refresh_token)
    session = await sessions.get(db, session_id)
    if session is None or session["revoked_at"] is not None or session["expires_at"] <= utcnow():
        raise Unauthorized("Invalid or expired refresh token", code="invalid_token")

    user = await users.get(db, session["user_id"])
    if user is None or user["status"] != "active":
        raise Unauthorized("Account is disabled", code="account_disabled")
    actor = _actor_for(user, request, settings, session.get("device_id"))

    new_secret = new_refresh_secret()
    rotated = secrets_match(secret, session["refresh_hash"]) and await sessions.rotate(
        db,
        session_id,
        session["refresh_hash"],
        hash_secret(new_secret),
        client_ip(request, settings),
        utcnow() + timedelta(days=settings.refresh_token_ttl_days),
    )
    if not rotated:
        # An old (already rotated) token was replayed: assume it leaked and kill the session.
        await sessions.revoke(db, session_id, "refresh_token_reuse")
        await audit.record(
            db, actor, "session.reuse_detected", entity="session", entity_id=session_id
        )
        raise Unauthorized("Refresh token was already used", code="refresh_token_reused")

    return _token_response(settings, user, session_id, session.get("device_id"), new_secret)


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
