"""Push (apply a device's outbox ops) and pull (serve a shop's changes after a cursor).

Ordering: every accepted write gets the next per-shop `seq` from `counters`; pull returns
documents with `seq > cursor` in seq order. Device clocks are never used to order.

Idempotency: an op_id already in `applied_ops` is acked again without being re-applied. The
check runs inside the push transaction, so a transaction retry (or two concurrent pushes of the
same op) can never apply an op twice.

Conflict rules (contracts/sync.schema.json, docs/architecture.md):
- products: the last write to reach the server wins; deletes are soft and also soft-delete the
  product's embeddings;
- embeddings: insert-only; deleted only with their product or to re-enrol it;
- sales: insert-only; a re-sent sale is acked unchanged and a delete is rejected.

A bad op is rejected with a reason (`<code>: <message>`) and never fails the whole batch.
"""

import base64
import binascii
from dataclasses import dataclass, replace
from typing import Any
from uuid import UUID

from pydantic import ValidationError

from app.core import audit
from app.core.audit import Actor
from app.core.clock import utcnow
from app.core.db import Database, Document, Session, in_transaction
from app.core.deps import ShopAccess
from app.core.errors import AppError
from app.core.permissions import Perm
from app.repositories import applied_ops, counters, devices, embeddings, products, sales
from app.schemas.sync import (
    EmbeddingPayload,
    EmbeddingRecord,
    Op,
    ProductPayload,
    ProductRecord,
    PullChanges,
    PullResponse,
    PushRequest,
    PushResponse,
    Rejection,
    SaleItemRecord,
    SalePayload,
    SaleRecord,
)

ENTITY_PERMISSION: dict[str, Perm] = {
    "products": Perm.CATALOGUE_WRITE,
    "embeddings": Perm.CATALOGUE_WRITE,
    "sales": Perm.SALES_CREATE,
}
MAX_CURSOR_DIGITS = 18


class Rejected(Exception):
    """One op cannot be applied. `reason` is returned to the device as `<code>: <message>`."""

    def __init__(self, code: str, message: str) -> None:
        super().__init__(f"{code}: {message}")
        self.reason = f"{code}: {message}"


@dataclass(slots=True)
class _Push:
    """State of one push attempt. Rebuilt from scratch if the transaction is retried."""

    db: Database
    access: ShopAccess
    actor: Actor
    session: Session

    @property
    def shop_id(self) -> UUID:
        return self.access.shop_id

    async def next_seq(self) -> int:
        return await counters.reserve(self.db, self.shop_id, 1, self.session)

    async def audit(self, action: str, entity: str, entity_id: UUID, **metadata: Any) -> None:
        await audit.record(
            self.db,
            self.actor,
            action,
            entity=entity,
            entity_id=entity_id,
            shop_id=self.shop_id,
            metadata=metadata,
            session=self.session,
        )


# --- Push ---------------------------------------------------------------------------------


async def push(db: Database, access: ShopAccess, body: PushRequest) -> PushResponse:
    actor = replace(access.caller.actor, device_id=body.device_id)

    async def write(session: Session) -> PushResponse:
        ctx = _Push(db, access, actor, session)
        applied = await applied_ops.owners(db, [op.op_id for op in body.ops], session)
        outcome: dict[UUID, str | None] = {}  # op_id → None (acked) or rejection reason
        newly_applied: list[UUID] = []
        for op in body.ops:
            if op.op_id in outcome:
                continue  # The same op twice in one request: same outcome as the first.
            if op.op_id in applied:
                same_shop = applied[op.op_id] == ctx.shop_id
                outcome[op.op_id] = None if same_shop else "op_conflict: op_id already used"
                continue
            try:
                await _apply(ctx, op)
            except Rejected as rejection:
                outcome[op.op_id] = rejection.reason
                continue
            outcome[op.op_id] = None
            newly_applied.append(op.op_id)
        await applied_ops.record(db, ctx.shop_id, newly_applied, session)
        await devices.upsert_device(db, body.device_id, ctx.shop_id, access.caller.user_id, session)
        return PushResponse(
            acked=[op_id for op_id, reason in outcome.items() if reason is None],
            rejected=[
                Rejection(op_id=op_id, reason=reason)
                for op_id, reason in outcome.items()
                if reason is not None
            ],
        )

    return await in_transaction(db, write)


async def _apply(ctx: _Push, op: Op) -> None:
    perm = ENTITY_PERMISSION[op.entity]
    if not ctx.access.has(perm):
        raise Rejected("permission_denied", f"{perm.value} is required to sync {op.entity}")
    if op.entity == "products":
        await _apply_product(ctx, op)
    elif op.entity == "embeddings":
        await _apply_embedding(ctx, op)
    else:
        await _apply_sale(ctx, op)


def _parse[M: ProductPayload | EmbeddingPayload | SalePayload](model: type[M], op: Op) -> M:
    try:
        payload = model.model_validate(op.payload)
    except ValidationError as exc:
        first = exc.errors()[0]
        where = ".".join(str(part) for part in first["loc"]) or "payload"
        raise Rejected("invalid_payload", f"{where}: {first['msg']}") from None
    if payload.id != op.entity_id:
        raise Rejected("invalid_payload", "payload.id must equal entity_id")
    return payload


def _check_owner(ctx: _Push, owners: dict[UUID, UUID], entity_id: UUID) -> bool:
    """True if the id already exists in this shop; rejects ids that belong to another shop."""
    owner = owners.get(entity_id)
    if owner is not None and owner != ctx.shop_id:
        raise Rejected("id_conflict", "this id belongs to another shop")
    return owner is not None


async def _apply_product(ctx: _Push, op: Op) -> None:
    exists = _check_owner(
        ctx, await products.owners(ctx.db, [op.entity_id], ctx.session), op.entity_id
    )
    now = utcnow()
    if op.op == "delete":
        current = (
            await products.get(ctx.db, ctx.shop_id, op.entity_id, ctx.session) if exists else None
        )
        if current is None or current["deleted"]:
            return  # Nothing (more) to delete: acked as a no-op.
        doc = {**current, "deleted": True, "updated_by": ctx.actor.id, "received_at": now}
        doc.pop("seq", None)
        doc.pop("shop_id", None)
    else:
        payload = _parse(ProductPayload, op)
        doc = {
            "_id": payload.id,
            "name": payload.name,
            "price_cents": payload.price_cents,
            "barcode": payload.barcode,
            "deleted": payload.deleted,
            "updated_at": payload.updated_at,
            "updated_by": ctx.actor.id,
            "received_at": now,
        }
    seq = await ctx.next_seq()
    await products.upsert(ctx.db, ctx.shop_id, doc, seq, ctx.session)
    action = "product.deleted" if doc["deleted"] else "product.upserted"
    await ctx.audit(action, "product", op.entity_id, op_id=op.op_id, seq=seq)
    if doc["deleted"]:
        for embedding_id in await embeddings.live_ids_for_product(
            ctx.db, ctx.shop_id, op.entity_id, ctx.session
        ):
            await _soft_delete_embedding(ctx, embedding_id, op.op_id)


async def _soft_delete_embedding(ctx: _Push, embedding_id: UUID, op_id: UUID) -> None:
    seq = await ctx.next_seq()
    await embeddings.soft_delete(ctx.db, ctx.shop_id, embedding_id, seq, utcnow(), ctx.session)
    await ctx.audit("embedding.deleted", "embedding", embedding_id, op_id=op_id, seq=seq)


async def _apply_embedding(ctx: _Push, op: Op) -> None:
    exists = _check_owner(
        ctx, await embeddings.owners(ctx.db, [op.entity_id], ctx.session), op.entity_id
    )
    if op.op == "delete":
        current = (
            await embeddings.get(ctx.db, ctx.shop_id, op.entity_id, ctx.session) if exists else None
        )
        if current is not None and not current["deleted"]:
            await _soft_delete_embedding(ctx, op.entity_id, op.op_id)
        return
    payload = _parse(EmbeddingPayload, op)
    if exists:
        return  # Insert-only: a re-sent embedding is acked unchanged.
    if payload.deleted:
        raise Rejected("invalid_payload", "a new embedding cannot be deleted; send a delete op")
    product = await products.get(ctx.db, ctx.shop_id, payload.product_id, ctx.session)
    if product is None:
        raise Rejected("unknown_product", f"product {payload.product_id} is not in this shop")
    if product["deleted"]:
        raise Rejected("product_deleted", f"product {payload.product_id} was deleted")
    try:
        vector = base64.b64decode(payload.vector_b64, validate=True)
    except binascii.Error:
        raise Rejected("invalid_payload", "vector_b64 is not valid base64") from None
    if len(vector) != payload.dim * 4:
        raise Rejected("invalid_payload", f"vector has {len(vector)} bytes, expected dim * 4")
    seq = await ctx.next_seq()
    doc: Document = {
        "_id": payload.id,
        "product_id": payload.product_id,
        "vector": vector,
        "dim": payload.dim,
        "model_version": payload.model_version,
        "deleted": False,
        "created_at": payload.created_at,
        "created_by": ctx.actor.id,
        "received_at": utcnow(),
    }
    await embeddings.insert(ctx.db, ctx.shop_id, doc, seq, ctx.session)
    await ctx.audit(
        "embedding.created",
        "embedding",
        payload.id,
        op_id=op.op_id,
        seq=seq,
        product_id=payload.product_id,
        model_version=payload.model_version,
    )


async def _apply_sale(ctx: _Push, op: Op) -> None:
    if op.op == "delete":
        raise Rejected("insert_only", "sales cannot be deleted (record a refund instead)")
    payload = _parse(SalePayload, op)
    if _check_owner(ctx, await sales.owners(ctx.db, [payload.id], ctx.session), payload.id):
        return  # Insert-only: a re-sent sale is acked unchanged.
    if payload.deleted:
        raise Rejected("insert_only", "sales cannot be deleted (record a refund instead)")
    total = sum(item.qty * item.unit_price_cents for item in payload.items)
    if total != payload.total_cents:
        raise Rejected("total_mismatch", f"items add up to {total}, not {payload.total_cents}")
    product_ids = list({item.product_id for item in payload.items})
    owners = await products.owners(ctx.db, product_ids, ctx.session)
    missing = [str(pid) for pid in product_ids if owners.get(pid) != ctx.shop_id]
    if missing:
        raise Rejected("unknown_product", f"not in this shop: {', '.join(sorted(missing))}")
    seq = await ctx.next_seq()
    doc: Document = {
        "_id": payload.id,
        "device_id": payload.device_id,
        "total_cents": payload.total_cents,
        "items": [item.model_dump() for item in payload.items],
        "deleted": False,
        "created_at": payload.created_at,
        "created_by": ctx.actor.id,
        "received_at": utcnow(),
    }
    await sales.insert(ctx.db, ctx.shop_id, doc, seq, ctx.session)
    await ctx.audit(
        "sale.created",
        "sale",
        payload.id,
        op_id=op.op_id,
        seq=seq,
        total_cents=payload.total_cents,
        items=len(payload.items),
    )


# --- Pull ---------------------------------------------------------------------------------


def parse_cursor(cursor: str | None) -> int:
    """The cursor is the decimal seq of the last change the device has; empty means 0."""
    if cursor is None or cursor == "":
        return 0
    if not cursor.isdigit() or len(cursor) > MAX_CURSOR_DIGITS:
        raise AppError("cursor must be a non-negative integer", code="invalid_cursor")
    return int(cursor)


async def pull(db: Database, access: ShopAccess, cursor: str | None, limit: int) -> PullResponse:
    after = parse_cursor(cursor)
    shop_id = access.shop_id
    # Without sales:read a member only gets back the sales they made themselves.
    created_by = None if access.has(Perm.SALES_READ) else access.caller.user_id
    # limit + 1 from each collection is enough to take the first limit + 1 of the merge.
    fetched: list[tuple[str, Document]] = [
        *(("products", d) for d in await products.changes_since(db, shop_id, after, limit + 1)),
        *(("embeddings", d) for d in await embeddings.changes_since(db, shop_id, after, limit + 1)),
        *(
            ("sales", d)
            for d in await sales.changes_since(db, shop_id, after, limit + 1, created_by)
        ),
    ]
    fetched.sort(key=lambda pair: pair[1]["seq"])
    page = fetched[:limit]
    changes = PullChanges(products=[], embeddings=[], sales=[])
    for kind, doc in page:
        if kind == "products":
            changes.products.append(_product_record(doc))
        elif kind == "embeddings":
            changes.embeddings.append(_embedding_record(doc))
        else:
            changes.sales.append(_sale_record(doc))
    next_cursor = str(page[-1][1]["seq"]) if page else str(after)
    return PullResponse(changes=changes, next_cursor=next_cursor, has_more=len(fetched) > limit)


def _product_record(doc: Document) -> ProductRecord:
    return ProductRecord(
        id=doc["_id"],
        name=doc["name"],
        price_cents=doc["price_cents"],
        barcode=doc["barcode"],
        deleted=doc["deleted"],
        updated_at=doc["updated_at"],
        seq=doc["seq"],
    )


def _embedding_record(doc: Document) -> EmbeddingRecord:
    return EmbeddingRecord(
        id=doc["_id"],
        product_id=doc["product_id"],
        vector_b64=base64.b64encode(bytes(doc["vector"])).decode("ascii"),
        dim=doc["dim"],
        model_version=doc["model_version"],
        deleted=doc["deleted"],
        created_at=doc["created_at"],
        seq=doc["seq"],
    )


def _sale_record(doc: Document) -> SaleRecord:
    return SaleRecord(
        id=doc["_id"],
        device_id=doc["device_id"],
        total_cents=doc["total_cents"],
        items=[SaleItemRecord.model_validate(item) for item in doc["items"]],
        deleted=doc["deleted"],
        created_at=doc["created_at"],
        seq=doc["seq"],
    )
