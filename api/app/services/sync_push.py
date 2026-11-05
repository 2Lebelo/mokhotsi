"""Applies a phone's outbox (sync v2, ADR 0005 amendment 2).

- The shop comes from the path and the phone's registration (DeviceShopAccess), never a payload.
- Idempotency: op_ids are kept in applied_ops for 180 days; a re-sent op is acked, never applied
  twice. A fact whose id is already stored is acked unchanged (another op carried it).
- Conflicts: products are replaced whole, and the last write to reach the server wins. Sales,
  reversals, stock movements and embeddings are insert-only facts; a deleted embedding keeps a
  tombstone, so it never comes back.
- Lost rights (decided 2026-10-27): a sale, refund or stock change by someone removed from the
  shop, or no longer allowed to make it, already happened in the shop: it is kept and flagged
  for the owner. A product edit by someone without catalogue:write is refused.
- Stock: phones never send a figure. Sales take units off, restocked reversal lines put them
  back (neither when `imported`: a sale made before registration is already in the opening
  stock), movements add their delta. stock_levels holds the sums, stock_movements the ledger.
- A bad op is rejected with a code and never fails the batch.

Everything runs in one transaction with a fixed number of round trips per batch. The change
feed's seqs are reserved last: the shop's counter document is then locked only for the commit,
and a concurrent push from another till conflicts on it and is retried after this one commits,
so seq order is commit order and the feed has no gaps (see changes.py).
"""

import base64
import binascii
import math
import struct
from collections import defaultdict
from datetime import datetime
from typing import Any
from uuid import UUID, uuid5

from bson import Binary
from pydantic import BaseModel, ValidationError

from app.core import audit
from app.core.clock import utcnow
from app.core.db import Database, Document, Session, in_transaction
from app.core.deps import DeviceShopAccess
from app.core.errors import Forbidden, UpgradeRequired
from app.core.permissions import MemberRole, Perm, shop_permissions
from app.repositories import (
    _sync_common,
    applied_ops,
    changes,
    counters,
    devices,
    embeddings,
    member_history,
    memberships,
    products,
    reversals,
    sales,
    stock_levels,
    stock_movements,
)
from app.schemas.sync import (
    PAYLOAD_MODELS,
    SCHEMA_VERSION,
    Embedding,
    EmbeddingDelete,
    Op,
    Product,
    PushRequest,
    PushResponse,
    Rejection,
    Reversal,
    Sale,
    StockMovement,
)

# "local": a change made on the phone before its shop was registered (claimed data).
LOCAL = "local"
# Ids of the stock movements the server derives from sale and reversal lines.
_DERIVED = UUID("6f4c2a51-6a8e-4a52-9d0c-2b0f1c7d8e93")

_COLLECTIONS = {
    "products": products.COLLECTION,
    "sales": sales.COLLECTION,
    "reversals": reversals.COLLECTION,
    "stock_movements": stock_movements.COLLECTION,
    "embeddings": embeddings.COLLECTION,
}


class _Rejected(Exception):
    def __init__(self, code: str, message: str) -> None:
        super().__init__(message)
        self.code = code
        self.message = message


def _parse(op: Op) -> tuple[BaseModel, bytes | None]:
    """The op's payload as its model (and an embedding's raw vector), or _Rejected."""
    if op.op == "delete" and op.entity != "embeddings":
        raise _Rejected("invalid_op", f"{op.entity} cannot be deleted")
    model = EmbeddingDelete if op.op == "delete" else PAYLOAD_MODELS[op.entity]
    try:
        payload = model.model_validate(op.payload)
    except ValidationError as exc:
        first = exc.errors()[0]
        where = ".".join(str(part) for part in first["loc"]) or "payload"
        raise _Rejected("invalid_payload", f"{where}: {first['msg']}") from None
    if payload.id != op.entity_id:  # type: ignore[attr-defined]
        raise _Rejected("invalid_op", "The payload id must equal entity_id")

    if isinstance(payload, Sale):
        for item in payload.items:
            if item.line_total_cents != item.unit_price_cents * item.quantity:
                raise _Rejected("total_mismatch", f"Line {item.id} does not add up")
        if payload.total_cents != sum(item.line_total_cents for item in payload.items):
            raise _Rejected("total_mismatch", "The lines do not add up to the total")
    if isinstance(payload, Reversal) and payload.refund_cents != sum(
        item.refund_cents for item in payload.items
    ):
        raise _Rejected("total_mismatch", "The lines do not add up to the refund")
    if isinstance(payload, Embedding):
        return payload, _vector(payload)
    return payload, None


def _vector(embedding: Embedding) -> bytes:
    try:
        raw = base64.b64decode(embedding.vector_f16, validate=True)
    except (binascii.Error, ValueError):
        raise _Rejected("invalid_payload", "vector_f16: not base64") from None
    if len(raw) != embedding.dim * 2:
        raise _Rejected("invalid_payload", f"vector_f16: expected {embedding.dim} float16 values")
    if not all(math.isfinite(value) for (value,) in struct.iter_unpack("<e", raw)):
        raise _Rejected("invalid_payload", "vector_f16: values must be finite")
    return raw


async def push(db: Database, access: DeviceShopAccess, body: PushRequest) -> PushResponse:
    if body.schema_version != SCHEMA_VERSION:
        raise UpgradeRequired("Update the app to keep this shop in sync.")
    if body.device_id != access.device_id:
        raise Forbidden("device_id is not the phone that signed in", code="device_mismatch")

    parsed: list[tuple[Op, BaseModel, bytes | None]] = []
    rejected: dict[UUID, Rejection] = {}
    seen: set[UUID] = set()
    for op in body.ops:
        if op.op_id in seen:  # Sent twice in one batch: one outcome.
            continue
        seen.add(op.op_id)
        try:
            parsed.append((op, *_parse(op)))
        except _Rejected as exc:
            rejected[op.op_id] = Rejection(op_id=op.op_id, code=exc.code, message=exc.message)

    async def run(session: Session) -> PushResponse:
        # A fresh plan per attempt: with_transaction retries the whole function.
        return await _Push(db, access, session, dict(rejected)).run(parsed)

    result = await in_transaction(db, run)
    order = {op.op_id: n for n, op in enumerate(body.ops)}
    result.rejected.sort(key=lambda rejection: order[rejection.op_id])
    return result


class _Push:
    def __init__(
        self,
        db: Database,
        access: DeviceShopAccess,
        session: Session,
        rejected: dict[UUID, Rejection],
    ) -> None:
        self.db = db
        self.access = access
        self.session = session
        self.shop_id = access.shop_id
        self.now = utcnow()
        # Only the phone that registered the shop's existing data may send changes made
        # before registration ("local"), which are attributed to the owner.
        self.claimant = access.shop.get("data_claimed_by_device") == access.device_id

        self.acked: list[UUID] = []
        self.applied: list[UUID] = []
        self.flagged: list[UUID] = []
        self.rejected = rejected

        self.product_docs: dict[UUID, Document] = {}
        self.inserts: dict[str, list[Document]] = defaultdict(list)
        self.embedding_docs: dict[UUID, Document] = {}
        self.embedding_deletes: list[UUID] = []
        self.deltas: dict[UUID, int] = defaultdict(int)
        # Ordered set of (entity, id) to append to the change feed; a record changed twice in
        # one batch appears once, at its last position.
        self.changed: dict[tuple[str, UUID], None] = {}

    # --- Loading: one query per kind of fact, whatever the batch size ---

    async def _load(self, ops: list[tuple[Op, BaseModel, bytes | None]]) -> None:
        db, s, shop = self.db, self.session, self.shop_id
        self.applied_owner = await applied_ops.owners(db, [op.op_id for op, _, _ in ops], s)

        ids: dict[str, list[UUID]] = defaultdict(list)
        variant_ids: list[UUID] = []
        product_ids: list[UUID] = []
        sale_ids: list[UUID] = []
        actors: list[UUID] = []
        for op, payload, _ in ops:
            ids[op.entity].append(op.entity_id)
            match payload:
                case Product():
                    actors += _uuids([payload.updated_by])
                case Sale():
                    variant_ids += [item.variant_id for item in payload.items]
                    actors += _uuids([payload.actor_user_id])
                case Reversal():
                    sale_ids.append(payload.sale_id)
                    actors += _uuids([payload.actor_user_id])
                case StockMovement():
                    variant_ids.append(payload.variant_id)
                    actors += _uuids([payload.actor_user_id])
                case Embedding():
                    product_ids.append(payload.product_id)

        self.owner: dict[str, dict[UUID, UUID]] = {}
        for entity, entity_ids in ids.items():
            self.owner[entity] = await _sync_common.owners(db, _COLLECTIONS[entity], entity_ids, s)
        self.stored_embeddings = await _sync_common.find_many(
            db, embeddings.COLLECTION, shop, ids["embeddings"], s
        )
        self.variants = await products.variant_products(db, shop, variant_ids, s)
        self.products = set(
            await _sync_common.find_many(db, products.COLLECTION, shop, product_ids, s)
        )
        self.sale_lines = {
            sale_id: {item["id"]: item for item in items}
            for sale_id, items in (await sales.items(db, shop, sale_ids, s)).items()
        }
        self.reversed = await reversals.reversed_quantities(db, shop, sale_ids, s)
        self.members = {
            m["user_id"]: shop_permissions(MemberRole(m["role"]), m["permissions"])
            for m in await memberships.for_users(db, shop, actors, s)
        }
        self.former = await member_history.former(db, shop, actors, s)
        self.seen: dict[str, set[UUID]] = defaultdict(set)

    # --- Checks shared by every entity ---

    def _stored(self, entity: str, entity_id: UUID) -> bool:
        """Whether this shop already has the record; another shop's id is refused."""
        owner = self.owner.get(entity, {}).get(entity_id)
        if owner is not None and owner != self.shop_id:
            raise _Rejected("id_conflict", "This id belongs to another shop")
        return owner is not None or entity_id in self.seen[entity]

    def _person(self, raw: str, *, local_ok: bool) -> tuple[UUID, frozenset[Perm] | None]:
        """The user behind an op and their permissions here now (None: removed from the shop)."""
        if raw == LOCAL:
            if not local_ok:
                raise _Rejected(
                    "unknown_actor",
                    "Changes from before the shop was registered must come from the phone "
                    "that registered it",
                )
            return self.access.shop["owner_id"], shop_permissions(MemberRole.OWNER, [])
        try:
            user_id = UUID(raw)
        except ValueError:
            raise _Rejected("unknown_actor", "Not a person of this shop") from None
        if user_id in self.members:
            return user_id, self.members[user_id]
        if user_id in self.former:
            return user_id, None
        raise _Rejected("unknown_actor", "This person has never worked at this shop")

    def _fact_actor(self, raw: str, need: Perm, *, local_ok: bool) -> tuple[UUID, list[str]]:
        user_id, permissions = self._person(raw, local_ok=local_ok)
        if permissions is None:
            return user_id, ["removed_actor"]
        return user_id, [] if need in permissions else ["not_allowed"]

    def _change(self, entity: str, entity_id: UUID) -> None:
        self.changed.pop((entity, entity_id), None)
        self.changed[(entity, entity_id)] = None

    def _stock(
        self,
        variant_id: UUID,
        delta: int,
        kind: str,
        line_id: UUID,
        ref_id: UUID,
        actor: UUID,
        created_at: datetime,
    ) -> None:
        """A server-derived ledger entry for a sale or reversal line (id stable per line)."""
        self.deltas[variant_id] += delta
        self.inserts[stock_movements.COLLECTION].append(
            {
                "_id": uuid5(_DERIVED, f"{kind}:{line_id}"),
                "shop_id": self.shop_id,
                "variant_id": variant_id,
                "delta": delta,
                "kind": kind,
                "ref_id": ref_id,
                "actor_user_id": actor,
                "device_id": self.access.device_id,
                "created_at": created_at,
            }
        )
        self._change("stock_levels", variant_id)

    # --- Entities ---

    def _product(self, p: Product) -> list[str]:
        self._stored("products", p.id)
        user_id, permissions = self._person(p.updated_by, local_ok=self.claimant)
        if permissions is None or Perm.CATALOGUE_WRITE not in permissions:
            raise _Rejected("permission_denied", "Only someone allowed to edit the catalogue can")
        self.product_docs[p.id] = {
            "_id": p.id,
            "shop_id": self.shop_id,
            "name": p.name,
            "category": p.category,
            "photos": [photo.model_dump() for photo in p.photos],
            "variants": [variant.model_dump() for variant in p.variants],
            "updated_by": user_id,
            "created_at": p.created_at,
            "updated_at": p.updated_at,
            "pushed_by": self.access.device_id,
            "received_at": self.now,
        }
        for variant in p.variants:
            self.variants[variant.id] = p.id
        self.products.add(p.id)
        self._change("products", p.id)
        return []

    def _sale(self, sale: Sale) -> list[str]:
        if self._stored("sales", sale.id):
            return []
        local_ok = sale.imported and self.claimant
        user_id, flags = self._fact_actor(sale.actor_user_id, Perm.SALES_CREATE, local_ok=local_ok)
        for item in sale.items:
            if item.variant_id not in self.variants:
                flags.append("unknown_variant")
            elif not sale.imported:
                self._stock(
                    item.variant_id,
                    -item.quantity,
                    "sale",
                    item.id,
                    sale.id,
                    user_id,
                    sale.created_at,
                )
        doc = sale.model_dump()
        doc |= {
            "_id": doc.pop("id"),
            "shop_id": self.shop_id,
            "actor_user_id": user_id,
            "flags": sorted(set(flags)),
            "pushed_by": self.access.device_id,
            "received_at": self.now,
        }
        self.inserts[sales.COLLECTION].append(doc)
        self.sale_lines[sale.id] = {item.id: item.model_dump() for item in sale.items}
        self.seen["sales"].add(sale.id)
        self._change("sales", sale.id)
        return flags

    def _reversal(self, reversal: Reversal) -> list[str]:
        if self._stored("reversals", reversal.id):
            return []
        lines = self.sale_lines.get(reversal.sale_id)
        if lines is None:
            raise _Rejected("unknown_sale", "The sale being reversed has not reached the server")
        for item in reversal.items:
            if item.sale_item_id not in lines:
                raise _Rejected("invalid_payload", f"items: {item.sale_item_id} is not on the sale")
        local_ok = reversal.imported and self.claimant
        user_id, flags = self._fact_actor(
            reversal.actor_user_id, Perm.SALES_REFUND, local_ok=local_ok
        )
        items = []
        for item in reversal.items:
            line = lines[item.sale_item_id]
            done = self.reversed.get(item.sale_item_id, 0) + item.quantity
            if done > line["quantity"]:
                flags.append("over_reversed")
            self.reversed[item.sale_item_id] = done
            variant_id = line["variant_id"]
            if item.restocked and not reversal.imported and variant_id in self.variants:
                self._stock(
                    variant_id,
                    item.quantity,
                    "reversal",
                    item.id,
                    reversal.id,
                    user_id,
                    reversal.created_at,
                )
            items.append({**item.model_dump(), "variant_id": variant_id})
        doc = reversal.model_dump()
        doc |= {
            "_id": doc.pop("id"),
            "items": items,
            "shop_id": self.shop_id,
            "actor_user_id": user_id,
            "flags": sorted(set(flags)),
            "pushed_by": self.access.device_id,
            "received_at": self.now,
        }
        self.inserts[reversals.COLLECTION].append(doc)
        self.seen["reversals"].add(reversal.id)
        self._change("reversals", reversal.id)
        return flags

    def _movement(self, movement: StockMovement) -> list[str]:
        if self._stored("stock_movements", movement.id):
            return []
        if movement.variant_id not in self.variants:
            raise _Rejected("unknown_variant", "This size has not reached the server")
        need = Perm.CATALOGUE_WRITE if movement.kind == "opening" else Perm.STOCK_WRITE
        user_id, flags = self._fact_actor(movement.actor_user_id, need, local_ok=self.claimant)
        self.deltas[movement.variant_id] += movement.delta
        self.inserts[stock_movements.COLLECTION].append(
            {
                "_id": movement.id,
                "shop_id": self.shop_id,
                "variant_id": movement.variant_id,
                "delta": movement.delta,
                "kind": movement.kind,
                "ref_id": None,
                "actor_user_id": user_id,
                "device_id": self.access.device_id,
                "created_at": movement.created_at,
                "flags": flags,
            }
        )
        self.seen["stock_movements"].add(movement.id)
        self._change("stock_levels", movement.variant_id)
        return flags

    def _embedding(self, embedding: Embedding, vector: bytes) -> list[str]:
        if self._stored("embeddings", embedding.id):
            return []  # Insert-only: a stored or deleted view stays as it is.
        if embedding.product_id not in self.products:
            raise _Rejected("unknown_product", "This product has not reached the server")
        self.embedding_docs[embedding.id] = {
            "_id": embedding.id,
            "shop_id": self.shop_id,
            "product_id": embedding.product_id,
            "model_version": embedding.model_version,
            "source": embedding.source,
            "image_sha256": embedding.image_sha256,
            "dim": embedding.dim,
            "vector": Binary(vector),
            "created_at": embedding.created_at,
            "deleted_at": None,
            "received_at": self.now,
        }
        self.seen["embeddings"].add(embedding.id)
        self._change("embeddings", embedding.id)
        return []

    def _embedding_delete(self, embedding_id: UUID) -> list[str]:
        if embedding_id in self.embedding_docs:  # Added earlier in this batch.
            self.embedding_docs[embedding_id]["deleted_at"] = self.now
        elif self._stored("embeddings", embedding_id):
            stored = self.stored_embeddings.get(embedding_id)
            if stored is None or stored["deleted_at"] is not None:
                return []
            self.embedding_deletes.append(embedding_id)
        else:
            return []  # Never reached the server: nothing to delete.
        self._change("embeddings", embedding_id)
        return []

    # --- Run ---

    async def run(self, ops: list[tuple[Op, BaseModel, bytes | None]]) -> PushResponse:
        await self._load(ops)
        for op, payload, vector in ops:
            owner = self.applied_owner.get(op.op_id)
            if owner is not None:
                if owner == self.shop_id:
                    self.acked.append(op.op_id)
                else:
                    self.rejected[op.op_id] = Rejection(
                        op_id=op.op_id, code="op_conflict", message="op_id already used"
                    )
                continue
            try:
                flags = self._apply(payload, vector)
            except _Rejected as exc:
                self.rejected[op.op_id] = Rejection(
                    op_id=op.op_id, code=exc.code, message=exc.message
                )
                continue
            self.acked.append(op.op_id)
            self.applied.append(op.op_id)
            if flags:
                self.flagged.append(op.op_id)
        seq = await self._write()
        return PushResponse(
            acked=self.acked,
            rejected=list(self.rejected.values()),
            flagged=self.flagged,
            seq=str(seq),
        )

    def _apply(self, payload: BaseModel, vector: bytes | None) -> list[str]:
        match payload:
            case Product():
                return self._product(payload)
            case Sale():
                return self._sale(payload)
            case Reversal():
                return self._reversal(payload)
            case StockMovement():
                return self._movement(payload)
            case Embedding():
                assert vector is not None  # noqa: S101 — _parse decodes every embedding
                return self._embedding(payload, vector)
            case EmbeddingDelete():
                return self._embedding_delete(payload.id)
        raise AssertionError(f"unhandled payload {type(payload).__name__}")

    async def _write(self) -> int:
        db, s, shop = self.db, self.session, self.shop_id
        await products.replace_many(db, list(self.product_docs.values()), s)
        for collection, docs in self.inserts.items():
            await _sync_common.insert_many(db, collection, docs, s)
        await _sync_common.insert_many(
            db, embeddings.COLLECTION, list(self.embedding_docs.values()), s
        )
        await embeddings.delete(db, shop, self.embedding_deletes, self.now, s)
        await stock_levels.add(db, shop, self.deltas, s)
        await applied_ops.record(db, shop, self.applied, s)
        if self.applied or self.rejected:
            await audit.record(
                db,
                self.access.actor,
                "sync.pushed",
                entity="device",
                entity_id=self.access.device_id,
                shop_id=shop,
                metadata=self._summary(),
                session=s,
            )
        await devices.touch_sync(db, self.access.device_id, shop, s)

        entries = list(self.changed)
        if not entries:
            return await counters.current(db, shop, s)
        # Last, so the counter is locked only for the commit (see the module docstring).
        first = await counters.reserve(db, shop, len(entries), s)
        await changes.append(db, shop, first, entries, self.now, s)
        return first + len(entries) - 1

    def _summary(self) -> dict[str, Any]:
        return {
            "applied": len(self.applied),
            "products": len(self.product_docs),
            "sales": len(self.inserts[sales.COLLECTION]),
            "reversals": len(self.inserts[reversals.COLLECTION]),
            "embeddings": len(self.embedding_docs) + len(self.embedding_deletes),
            "flagged": self.flagged,
            "rejected": [{"op_id": r.op_id, "code": r.code} for r in self.rejected.values()],
        }


def _uuids(raw: list[str]) -> list[UUID]:
    found = []
    for value in raw:
        try:
            found.append(UUID(value))
        except ValueError:
            continue
    return found
