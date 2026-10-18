"""Reading the audit log (system-wide for admins, per shop for keepers)."""

from datetime import datetime
from uuid import UUID

from app.core.db import Database, Document
from app.core.pagination import PageParams, build_page_query
from app.repositories import audit_logs
from app.schemas.audit import AuditLogOut

AUDIT_SORTS = {"created_at": "created_at"}


def to_out(doc: Document) -> AuditLogOut:
    return AuditLogOut(id=doc["_id"], **{k: v for k, v in doc.items() if k != "_id"})


async def list_logs(
    db: Database,
    params: PageParams,
    *,
    shop_id: UUID | None = None,
    actor_id: UUID | None = None,
    action: str | None = None,
    entity: str | None = None,
    entity_id: UUID | None = None,
    created_from: datetime | None = None,
    created_to: datetime | None = None,
) -> tuple[list[AuditLogOut], str | None]:
    base: Document = {}
    for field, value in (
        ("shop_id", shop_id),
        ("actor_id", actor_id),
        ("action", action),
        ("entity", entity),
        ("entity_id", entity_id),
    ):
        if value is not None:
            base[field] = value
    if created_from or created_to:
        window: Document = {}
        if created_from:
            window["$gte"] = created_from
        if created_to:
            window["$lt"] = created_to
        base["created_at"] = window
    query = build_page_query(params, base, AUDIT_SORTS, "-created_at")
    docs, next_cursor = query.finish(await audit_logs.list_page(db, query))
    return [to_out(d) for d in docs], next_cursor
