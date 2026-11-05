"""Sync issues: phones report what they could not sync as asked; the system admin reviews them.

Owners and cashiers never see these (decided 2026-10-28): the till stays free of sync
bookkeeping, and the admin, who supports every shop, follows up.
"""

from uuid import UUID

from app.core import audit
from app.core.clock import utcnow
from app.core.db import Database, Document, Session, in_transaction
from app.core.deps import Caller, DeviceShopAccess
from app.core.errors import NotFound
from app.core.pagination import PageParams, build_page_query
from app.repositories import devices, shops, sync_issues, users
from app.schemas.sync_issues import (
    SyncIssueCount,
    SyncIssueOut,
    SyncIssuesReport,
    SyncIssuesReported,
)

ISSUE_SORTS = {"received_at": "received_at"}


async def report(
    db: Database, access: DeviceShopAccess, body: SyncIssuesReport
) -> SyncIssuesReported:
    """Stores what the phone reports for its shop. Idempotent by issue id."""
    now = utcnow()
    docs = [
        {
            "_id": issue.id,
            "shop_id": access.shop_id,
            "device_id": access.device_id,
            "kind": issue.kind,
            "entity": issue.entity,
            "entity_id": issue.entity_id,
            "op_id": issue.op_id,
            "code": issue.code,
            "message": issue.message,
            "created_at": issue.created_at,
            "received_at": now,
            "resolved_at": None,
            "resolved_by": None,
        }
        for issue in body.issues
    ]
    await sync_issues.insert_new(db, docs)
    return SyncIssuesReported(accepted=[issue.id for issue in body.issues])


async def list_issues(
    db: Database, params: PageParams, *, resolved: bool
) -> tuple[list[SyncIssueOut], str | None]:
    base: Document = {"resolved_at": {"$ne": None} if resolved else None}
    query = build_page_query(params, base, ISSUE_SORTS, "-received_at")
    docs, next_cursor = query.finish(await sync_issues.list_page(db, query))
    return await _describe(db, docs), next_cursor


async def count_open(db: Database) -> SyncIssueCount:
    return SyncIssueCount(open=await sync_issues.count_open(db))


async def resolve(db: Database, caller: Caller, issue_id: UUID) -> SyncIssueOut:
    """Idempotent: resolving a resolved issue changes nothing."""

    async def write(s: Session) -> Document | None:
        doc = await sync_issues.get(db, issue_id, s)
        if doc is None:
            return None
        if await sync_issues.resolve(db, issue_id, caller.user_id, utcnow(), s):
            await audit.record(
                db,
                caller.actor,
                "sync_issue.resolved",
                entity="sync_issue",
                entity_id=issue_id,
                shop_id=doc["shop_id"],
                session=s,
            )
        return await sync_issues.get(db, issue_id, s)

    doc = await in_transaction(db, write)
    if doc is None:
        raise NotFound("Issue not found")
    (out,) = await _describe(db, [doc])
    return out


async def _describe(db: Database, docs: list[Document]) -> list[SyncIssueOut]:
    """Adds the shop, its owner and the phone, in three reads whatever the page size."""
    shop_docs = await shops.get_many(db, list({d["shop_id"] for d in docs}))
    owner_ids = list({s["owner_id"] for s in shop_docs.values() if s.get("owner_id")})
    owner_docs = await users.get_many(db, owner_ids)
    device_docs = await devices.get_many(db, list({d["device_id"] for d in docs}))
    out: list[SyncIssueOut] = []
    for doc in docs:
        shop = shop_docs.get(doc["shop_id"])
        owner = owner_docs.get(shop["owner_id"]) if shop and shop.get("owner_id") else None
        device = device_docs.get(doc["device_id"])
        out.append(
            SyncIssueOut(
                id=doc["_id"],
                kind=doc["kind"],
                entity=doc["entity"],
                entity_id=doc["entity_id"],
                op_id=doc["op_id"],
                code=doc["code"],
                message=doc["message"],
                created_at=doc["created_at"],
                received_at=doc["received_at"],
                resolved_at=doc["resolved_at"],
                resolved_by=doc["resolved_by"],
                shop_id=doc["shop_id"],
                shop_name=shop["name"] if shop else None,
                owner_id=owner["_id"] if owner else None,
                owner_name=owner["name"] if owner else None,
                owner_phone=owner.get("phone") if owner else None,
                device_id=doc["device_id"],
                device_name=device["name"] if device else None,
            )
        )
    return out
