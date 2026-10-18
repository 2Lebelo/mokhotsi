"""Write audit entries. Call `record` inside the same transaction as the change it describes.

Action names are `<entity>.<verb>` in the past tense (e.g. `user.created`, `member.updated`).
Secrets are never written: fields in REDACTED are dropped from `changes`.
"""

from collections.abc import Iterable
from dataclasses import dataclass
from typing import Any
from uuid import UUID, uuid4

from fastapi import Request

from app.core.clock import utcnow
from app.core.config import Settings
from app.core.db import Database, Document, Session
from app.core.request_meta import client_ip, request_id, user_agent
from app.repositories import audit_logs

REDACTED = frozenset({"password", "password_hash", "refresh_hash"})


@dataclass(frozen=True, slots=True)
class Actor:
    """Who did it and from where. `id` is None for anonymous or system (CLI) actions."""

    id: UUID | None
    role: str | None
    email: str | None
    ip: str | None = None
    request_id: str | None = None
    user_agent: str | None = None
    device_id: UUID | None = None

    @classmethod
    def anonymous(cls, request: Request, settings: Settings, email: str | None = None) -> "Actor":
        return cls(
            id=None,
            role=None,
            email=email,
            ip=client_ip(request, settings),
            request_id=request_id(request),
            user_agent=user_agent(request),
        )

    @classmethod
    def system(cls, source: str) -> "Actor":
        return cls(id=None, role="system", email=None, user_agent=source)


def diff(before: Document, after: Document, fields: Iterable[str]) -> dict[str, dict[str, Any]]:
    """{field: {"from": old, "to": new}} for the fields that changed (secrets excluded)."""
    return {
        f: {"from": before.get(f), "to": after.get(f)}
        for f in fields
        if f not in REDACTED and before.get(f) != after.get(f)
    }


def snapshot(doc: Document, fields: Iterable[str]) -> dict[str, Any]:
    """The listed fields of a newly created document (for `*.created` entries)."""
    return {f: doc.get(f) for f in fields if f not in REDACTED}


async def record(
    db: Database,
    actor: Actor,
    action: str,
    *,
    entity: str,
    entity_id: UUID | None,
    shop_id: UUID | None = None,
    changes: dict[str, Any] | None = None,
    metadata: dict[str, Any] | None = None,
    session: Session | None = None,
) -> None:
    await audit_logs.insert(
        db,
        {
            "_id": uuid4(),
            "created_at": utcnow(),
            "action": action,
            "entity": entity,
            "entity_id": entity_id,
            "shop_id": shop_id,
            "actor_id": actor.id,
            "actor_role": actor.role,
            "actor_email": actor.email,
            "changes": changes or None,
            "metadata": metadata or None,
            "request_id": actor.request_id,
            "ip": actor.ip,
            "user_agent": actor.user_agent,
            "device_id": actor.device_id,
        },
        session=session,
    )
