"""What a phone downloads (sync v2): pull (changes after a cursor) and snapshot (a new phone).

Both read in one snapshot session, so the counter, the change feed and the records are seen at
the same instant: a page can never mention a change whose record it cannot see. Records are sent
as their current state; applying one twice is harmless, so a phone that pages through a
snapshot while tills keep selling simply catches up with pull from the first page's seq.
"""

import base64
from datetime import datetime, timedelta
from typing import Any
from uuid import UUID

from app.core.clock import utcnow
from app.core.db import Database, Document, Session
from app.core.deps import DeviceShopAccess
from app.core.errors import AppError, Gone, Unprocessable
from app.repositories import (
    _sync_common,
    changes,
    counters,
    embeddings,
    products,
    reversals,
    sales,
    stock_levels,
)
from app.schemas.sync import (
    Change,
    Embedding,
    EmbeddingTombstone,
    Product,
    PullResponse,
    Record,
    Reversal,
    Sale,
    SnapshotEntity,
    SnapshotResponse,
    StockLevel,
)

MAX_CURSOR_DIGITS = 18
# A vector is ~3.4 KB on the wire; this keeps a page near 1 MB on a slow connection.
VECTORS_PER_PAGE = 250
SNAPSHOT_DAYS = 90

_COLLECTIONS = {
    "products": products.COLLECTION,
    "sales": sales.COLLECTION,
    "reversals": reversals.COLLECTION,
    "stock_levels": stock_levels.COLLECTION,
    "embeddings": embeddings.COLLECTION,
}


def parse_cursor(cursor: str | None) -> int:
    if not cursor:
        return 0
    if not cursor.isdigit() or len(cursor) > MAX_CURSOR_DIGITS:
        raise AppError("cursor must be a seq from next_cursor", code="invalid_cursor")
    return int(cursor)


def _expired() -> Gone:
    return Gone(
        "This phone has been away too long to catch up; it must download the shop again.",
        code="cursor_expired",
    )


async def pull(
    db: Database, access: DeviceShopAccess, cursor: str | None, limit: int
) -> PullResponse:
    after = parse_cursor(cursor)
    shop = access.shop_id
    async with db.client.start_session(snapshot=True) as s:
        latest = await counters.current(db, shop, s)
        if after > latest:
            raise _expired()
        if after == latest:
            return PullResponse(changes=[], next_cursor=str(latest), has_more=False)

        entries = await changes.window(db, shop, after, latest, limit, s)
        if not entries or entries[0]["seq"] != after + 1:
            raise _expired()  # The start of that history was pruned (180 days).
        page: list[Document] = []
        vectors = 0
        for entry in entries:
            if entry["entity"] == "embeddings":
                vectors += 1
                if vectors > VECTORS_PER_PAGE and page:
                    break
            page.append(entry)

        # One entry per record, at its last position: the record is sent as it is now.
        last_seq: dict[tuple[str, UUID], int] = {}
        for entry in page:
            last_seq[(entry["entity"], entry["entity_id"])] = entry["seq"]
        records = await _records(db, shop, list(last_seq), s)
        found = [
            Change(seq=seq, entity=entity, record=records[(entity, entity_id)])  # type: ignore[arg-type]
            for (entity, entity_id), seq in sorted(last_seq.items(), key=lambda item: item[1])
            if (entity, entity_id) in records
        ]
        next_cursor = page[-1]["seq"]
        return PullResponse(
            changes=found, next_cursor=str(next_cursor), has_more=next_cursor < latest
        )


async def _records(
    db: Database, shop: UUID, keys: list[tuple[str, UUID]], s: Session
) -> dict[tuple[str, UUID], Record]:
    wanted: dict[str, list[UUID]] = {}
    for entity, entity_id in keys:
        wanted.setdefault(entity, []).append(entity_id)
    found: dict[tuple[str, UUID], Record] = {}
    for entity, ids in wanted.items():
        docs = await _sync_common.find_many(db, _COLLECTIONS[entity], shop, ids, s)
        for doc_id, doc in docs.items():
            found[(entity, doc_id)] = to_record(entity, doc)
    return found


def to_record(entity: str, doc: Document) -> Record:
    match entity:
        case "products":
            return Product.model_validate({**_public(doc), "updated_by": str(doc["updated_by"])})
        case "sales":
            return Sale.model_validate({**_public(doc), "actor_user_id": str(doc["actor_user_id"])})
        case "reversals":
            items = [{k: v for k, v in i.items() if k != "variant_id"} for i in doc["items"]]
            return Reversal.model_validate(
                {**_public(doc), "items": items, "actor_user_id": str(doc["actor_user_id"])}
            )
        case "stock_levels":
            return StockLevel(variant_id=doc["_id"], stock=doc["stock"])
        case "embeddings":
            if doc["deleted_at"] is not None:
                return EmbeddingTombstone(id=doc["_id"], product_id=doc["product_id"], deleted=True)
            return Embedding(
                id=doc["_id"],
                product_id=doc["product_id"],
                model_version=doc["model_version"],
                source=doc["source"],
                image_sha256=doc["image_sha256"],
                dim=doc["dim"],
                vector_f16=base64.b64encode(bytes(doc["vector"])).decode(),
                created_at=doc["created_at"],
            )
    raise AssertionError(f"unknown entity {entity}")


# Server-side bookkeeping that is not part of the contract's records.
_PRIVATE = {"shop_id", "received_at", "pushed_by", "flags", "deleted_at"}


def _public(doc: Document) -> dict[str, Any]:
    out = {k: v for k, v in doc.items() if k not in _PRIVATE and k != "_id"}
    out["id"] = doc["_id"]
    return out


async def snapshot(
    db: Database,
    access: DeviceShopAccess,
    entity: SnapshotEntity,
    after: str | None,
    limit: int,
    model_version: str | None,
) -> SnapshotResponse:
    shop = access.shop_id
    collection = _COLLECTIONS[entity]
    async with db.client.start_session(snapshot=True) as s:
        seq = await counters.current(db, shop, s)
        if entity in ("sales", "reversals"):
            since = utcnow() - timedelta(days=SNAPSHOT_DAYS)
            docs = await _sync_common.page_by_time(
                db,
                collection,
                {"shop_id": shop, "created_at": {"$gte": since}},
                _time_key(after),
                limit + 1,
                s,
            )
        else:
            query: Document = {"shop_id": shop}
            if entity == "embeddings":
                if not model_version:
                    raise Unprocessable(
                        "model_version is required for embeddings", code="validation_error"
                    )
                query |= {"model_version": model_version, "deleted_at": None}
            docs = await _sync_common.page_by_id(
                db, collection, query, _id_key(after), limit + 1, s
            )

    has_more = len(docs) > limit
    docs = docs[:limit]
    next_after = None
    if has_more:
        last = docs[-1]
        next_after = (
            f"{last['created_at'].isoformat()}|{last['_id']}"
            if entity in ("sales", "reversals")
            else str(last["_id"])
        )
    return SnapshotResponse(
        entity=entity,
        records=[to_record(entity, doc) for doc in docs],  # type: ignore[misc]
        after=next_after,
        has_more=has_more,
        snapshot_seq=str(seq),
    )


def _bad_after() -> AppError:
    return AppError("after must be a value from a previous page", code="invalid_cursor")


def _id_key(after: str | None) -> UUID | None:
    if not after:
        return None
    try:
        return UUID(after)
    except ValueError:
        raise _bad_after() from None


def _time_key(after: str | None) -> tuple[datetime, UUID] | None:
    if not after:
        return None
    created_at, _, last_id = after.partition("|")
    try:
        return datetime.fromisoformat(created_at), UUID(last_id)
    except ValueError:
        raise _bad_after() from None
