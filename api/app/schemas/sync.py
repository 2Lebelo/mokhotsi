"""Pydantic mirror of contracts/sync.schema.json (tests/test_contracts.py guards against drift)."""

from typing import Annotated, Any, Literal
from uuid import UUID

from pydantic import AwareDatetime, Field

from app.schemas.common import Cents, Seq, StrictModel

PUSH_MAX_OPS = 200
PULL_MAX_LIMIT = 500

Entity = Literal["products", "embeddings", "sales"]
OpKind = Literal["upsert", "delete"]
MatchMethod = Literal["vision", "barcode", "manual"]


class Op(StrictModel):
    op_id: UUID = Field(description="Idempotency key (recorded in applied_ops for 30 days)")
    entity: Entity
    entity_id: UUID
    op: OpKind
    payload: dict[str, Any] = Field(description="Upsert: the record without `seq`. Delete: {}.")


class PushRequest(StrictModel):
    device_id: UUID
    ops: Annotated[list[Op], Field(min_length=1, max_length=PUSH_MAX_OPS)]


class Rejection(StrictModel):
    op_id: UUID
    reason: Annotated[str, Field(min_length=1)]


class PushResponse(StrictModel):
    acked: list[UUID]
    rejected: list[Rejection]


class ProductRecord(StrictModel):
    id: UUID
    name: Annotated[str, Field(min_length=1)]
    price_cents: Cents
    barcode: str | None
    deleted: bool
    updated_at: AwareDatetime
    seq: Seq


class EmbeddingRecord(StrictModel):
    id: UUID
    product_id: UUID
    vector_b64: str = Field(description="Base64 of `dim` little-endian float32 values")
    dim: Annotated[int, Field(ge=1)]
    model_version: Annotated[str, Field(min_length=1)]
    deleted: bool
    created_at: AwareDatetime
    seq: Seq


class SaleItemRecord(StrictModel):
    id: UUID
    product_id: UUID
    qty: Annotated[int, Field(ge=1, strict=True)]
    unit_price_cents: Cents
    match_score: Annotated[float, Field(ge=-1, le=1)] | None
    match_method: MatchMethod


class SaleRecord(StrictModel):
    id: UUID
    device_id: UUID
    total_cents: Cents
    items: Annotated[list[SaleItemRecord], Field(min_length=1)]
    deleted: bool
    created_at: AwareDatetime
    seq: Seq


class PullChanges(StrictModel):
    products: list[ProductRecord]
    embeddings: list[EmbeddingRecord]
    sales: list[SaleRecord]


class PullResponse(StrictModel):
    changes: PullChanges
    next_cursor: str = Field(description="Opaque; send back as ?cursor= on the next pull")
    has_more: bool


# Model per $defs entry, used by the contract test.
CONTRACT_MODELS: dict[str, type[StrictModel]] = {
    "Op": Op,
    "PushRequest": PushRequest,
    "Rejection": Rejection,
    "PushResponse": PushResponse,
    "ProductRecord": ProductRecord,
    "EmbeddingRecord": EmbeddingRecord,
    "SaleItemRecord": SaleItemRecord,
    "SaleRecord": SaleRecord,
    "PullChanges": PullChanges,
    "PullResponse": PullResponse,
}
