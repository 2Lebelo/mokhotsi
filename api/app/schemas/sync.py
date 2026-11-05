"""Pydantic mirror of contracts/sync.v2.schema.json (tests/test_contracts.py guards against drift),
plus the photo endpoints (described by OpenAPI only)."""

from typing import Annotated, Any, Literal
from uuid import UUID

from pydantic import AwareDatetime, Field, StringConstraints, field_validator

from app.schemas.common import Seq, StrictModel

SCHEMA_VERSION = 2
PUSH_MAX_OPS = 200
PULL_MAX_LIMIT = 500
SNAPSHOT_MAX_LIMIT = 500
PHOTO_BATCH = 50
PHOTO_URL_BATCH = 100
MAX_SAFE = 2**53 - 1

Entity = Literal["products", "sales", "reversals", "stock_movements", "embeddings"]
OpKind = Literal["upsert", "delete"]
MovementKind = Literal["opening", "restock", "adjustment"]
EmbeddingSource = Literal["photo", "teach", "correction"]
ChangeEntity = Literal["products", "sales", "reversals", "stock_levels", "embeddings"]
SnapshotEntity = Literal["products", "stock_levels", "sales", "reversals", "embeddings"]
PhotoKind = Literal["photo", "crop"]

Actor = Annotated[str, StringConstraints(min_length=1, max_length=64)]
Sha256 = Annotated[str, StringConstraints(pattern=r"^[0-9a-f]{64}$")]
Quantity = Annotated[int, Field(ge=1, le=MAX_SAFE, strict=True)]
SafeCents = Annotated[int, Field(ge=0, le=MAX_SAFE, strict=True)]
Text = Annotated[str, StringConstraints(min_length=1, max_length=200)]
Cursor = Annotated[str, Field(pattern=r"^[0-9]+$")]


class ProductVariant(StrictModel):
    id: UUID
    size_milli: Annotated[int, Field(ge=1, le=MAX_SAFE, strict=True)]
    unit: Annotated[str, StringConstraints(min_length=1, max_length=16)]
    price_cents: SafeCents
    cost_cents: SafeCents | None
    barcode: Annotated[str, StringConstraints(max_length=64)] | None
    position: Annotated[int, Field(ge=0, strict=True)]
    archived_at: AwareDatetime | None


class ProductPhoto(StrictModel):
    slot: Literal[0, 1]
    sha256: Sha256


class Product(StrictModel):
    id: UUID
    name: Text
    category: Text
    photos: Annotated[list[ProductPhoto], Field(max_length=2)]
    updated_by: Actor
    created_at: AwareDatetime
    updated_at: AwareDatetime
    variants: Annotated[list[ProductVariant], Field(min_length=1, max_length=100)]


class SaleItem(StrictModel):
    id: UUID
    product_id: UUID
    variant_id: UUID
    product_name: Text
    variant_label: Text
    category: Text
    barcode: Annotated[str, StringConstraints(max_length=64)] | None
    quantity: Quantity
    unit_price_cents: SafeCents
    line_total_cents: SafeCents
    unit_cost_cents: SafeCents | None


class Sale(StrictModel):
    id: UUID
    total_cents: SafeCents
    tendered_cents: SafeCents | None
    change_cents: SafeCents | None
    actor_user_id: Actor
    device_id: Actor
    imported: bool
    created_at: AwareDatetime
    items: Annotated[list[SaleItem], Field(min_length=1, max_length=500)]


class ReversalItem(StrictModel):
    id: UUID
    sale_item_id: UUID
    quantity: Quantity
    restocked: bool
    refund_cents: SafeCents


class Reversal(StrictModel):
    id: UUID
    sale_id: UUID
    reason: Annotated[str, StringConstraints(min_length=1, max_length=500)]
    refund_cents: SafeCents
    actor_user_id: Actor
    device_id: Actor
    imported: bool
    created_at: AwareDatetime
    items: Annotated[list[ReversalItem], Field(min_length=1, max_length=500)]


class StockMovement(StrictModel):
    id: UUID
    variant_id: UUID
    delta: Annotated[int, Field(ge=-MAX_SAFE, le=MAX_SAFE, strict=True)]
    kind: MovementKind
    actor_user_id: Actor
    device_id: Actor
    created_at: AwareDatetime

    @field_validator("delta")
    @classmethod
    def _not_zero(cls, value: int) -> int:
        if value == 0:
            raise ValueError("a movement must change the stock")
        return value


class StockLevel(StrictModel):
    variant_id: UUID
    stock: int


class Embedding(StrictModel):
    id: UUID
    product_id: UUID
    model_version: Annotated[str, StringConstraints(min_length=1, max_length=120)]
    source: EmbeddingSource
    image_sha256: Sha256 | None
    dim: Annotated[int, Field(ge=1, le=4096, strict=True)]
    vector_f16: Annotated[str, StringConstraints(min_length=4, max_length=11_000)] = Field(
        description="Base64 of `dim` little-endian IEEE-754 binary16 values (L2-normalised)"
    )
    created_at: AwareDatetime


class EmbeddingDelete(StrictModel):
    id: UUID


class EmbeddingTombstone(StrictModel):
    id: UUID
    product_id: UUID
    deleted: Literal[True]


class Op(StrictModel):
    op_id: UUID = Field(description="Idempotency key (remembered for 180 days)")
    entity: Entity
    entity_id: UUID
    op: OpKind
    payload: dict[str, Any] = Field(
        description="The record for `entity` (Product, Sale, Reversal, StockMovement, Embedding); "
        "for an embedding delete, {id}."
    )


class PushRequest(StrictModel):
    device_id: UUID = Field(description="Must be the device of the token")
    schema_version: int = Field(description=f"Must be {SCHEMA_VERSION}; older apps get 426")
    ops: Annotated[list[Op], Field(min_length=1, max_length=PUSH_MAX_OPS)]


class Rejection(StrictModel):
    op_id: UUID
    code: Annotated[str, Field(min_length=1)]
    message: Annotated[str, Field(min_length=1)]


class PushResponse(StrictModel):
    acked: list[UUID]
    rejected: list[Rejection]
    flagged: list[UUID] = Field(description="Acked ops recorded for the owner to review")
    seq: Cursor = Field(description="The shop's latest seq after this push")


Record = Product | Sale | Reversal | StockLevel | Embedding | EmbeddingTombstone


class Change(StrictModel):
    seq: Seq
    entity: ChangeEntity
    record: Record = Field(description="The current state of the record, not the op")


class PullResponse(StrictModel):
    changes: list[Change]
    next_cursor: Cursor
    has_more: bool


class SnapshotResponse(StrictModel):
    entity: SnapshotEntity
    records: list[Product | Sale | Reversal | StockLevel | Embedding]
    after: str | None = Field(description="Pass back as ?after= for the next page")
    has_more: bool
    snapshot_seq: Cursor = Field(description="Continue with pull from this cursor")


# Model per $defs entry, used by the contract test.
CONTRACT_MODELS: dict[str, type[StrictModel]] = {
    "ProductVariant": ProductVariant,
    "ProductPhoto": ProductPhoto,
    "Product": Product,
    "SaleItem": SaleItem,
    "Sale": Sale,
    "ReversalItem": ReversalItem,
    "Reversal": Reversal,
    "StockMovement": StockMovement,
    "StockLevel": StockLevel,
    "Embedding": Embedding,
    "EmbeddingDelete": EmbeddingDelete,
    "EmbeddingTombstone": EmbeddingTombstone,
    "Op": Op,
    "PushRequest": PushRequest,
    "Rejection": Rejection,
    "PushResponse": PushResponse,
    "Change": Change,
    "PullResponse": PullResponse,
    "SnapshotResponse": SnapshotResponse,
}

PAYLOAD_MODELS: dict[str, type[StrictModel]] = {
    "products": Product,
    "sales": Sale,
    "reversals": Reversal,
    "stock_movements": StockMovement,
    "embeddings": Embedding,
}


# --- Photos (product photos and correction crops in Cloudinary) ---


class PhotoUpload(StrictModel):
    sha256: Sha256
    kind: PhotoKind
    bytes: Annotated[int, Field(ge=1, strict=True)]


class PhotoUploadsRequest(StrictModel):
    items: Annotated[list[PhotoUpload], Field(min_length=1, max_length=PHOTO_BATCH)]


class PhotoTicket(StrictModel):
    sha256: Sha256
    existing: bool = Field(description="The shop already has this image: nothing to upload")
    problem: Literal["too_large"] | None = None
    upload_url: str | None = None
    fields: dict[str, str] | None = Field(
        default=None, description="Send these form fields unchanged, plus `file`"
    )
    expires_at: AwareDatetime | None = None


class PhotoUploadsResponse(StrictModel):
    tickets: list[PhotoTicket]


class PhotoConfirm(StrictModel):
    sha256: Sha256
    kind: PhotoKind
    public_id: Annotated[str, StringConstraints(min_length=1, max_length=255)]
    version: Annotated[int, Field(ge=1, strict=True)]
    signature: Annotated[str, StringConstraints(min_length=1, max_length=128)]
    format: Annotated[str, StringConstraints(pattern=r"^(jpg|jpeg|png|webp)$")]
    bytes: Annotated[int, Field(ge=1, strict=True)]
    width: Annotated[int, Field(ge=1, strict=True)]
    height: Annotated[int, Field(ge=1, strict=True)]


class PhotoConfirmRequest(StrictModel):
    items: Annotated[list[PhotoConfirm], Field(min_length=1, max_length=PHOTO_BATCH)]


class PhotoRejection(StrictModel):
    sha256: Sha256
    code: str
    message: str


class PhotoConfirmResponse(StrictModel):
    confirmed: list[Sha256]
    rejected: list[PhotoRejection]


class PhotoUrlsRequest(StrictModel):
    sha256s: Annotated[list[Sha256], Field(min_length=1, max_length=PHOTO_URL_BATCH)]


class PhotoUrlsResponse(StrictModel):
    urls: dict[str, str | None] = Field(description="null: the shop has no such image (yet)")
