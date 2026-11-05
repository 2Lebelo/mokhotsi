// TypeScript mirror of the payloads in contracts/sync.v2.schema.json. Ops are
// queued locally with these payloads and pushed once the shop is bound to a server.

/** Bumped on any breaking change to an op payload; sent with every push. */
export const SYNC_SCHEMA_VERSION = 2;

export type SyncEntity =
  | "products"
  | "sales"
  | "reversals"
  | "stock_movements"
  | "embeddings";

/** Entities whose pending op is replaced by the latest state (last write wins). */
export const UPSERT_ENTITIES: readonly SyncEntity[] = ["products"];

export type ProductVariantPayload = {
  id: string;
  size_milli: number;
  unit: string;
  price_cents: number;
  cost_cents: number | null;
  barcode: string | null;
  position: number;
  archived_at: string | null;
};

/** A product photo by content hash; its bytes go to Cloudinary (slot 0: main, 1: another angle). */
export type ProductPhotoPayload = { slot: 0 | 1; sha256: string };

/** A product with all its sizes. Stock is not part of it: it travels as movements. */
export type ProductPayload = {
  id: string;
  name: string;
  category: string;
  photos: ProductPhotoPayload[];
  /** Who made this edit; the server refuses it unless they may edit the catalogue. */
  updated_by: string;
  created_at: string;
  updated_at: string;
  variants: ProductVariantPayload[];
};

export type SaleItemPayload = {
  id: string;
  product_id: string;
  variant_id: string;
  product_name: string;
  variant_label: string;
  category: string;
  barcode: string | null;
  quantity: number;
  unit_price_cents: number;
  line_total_cents: number;
  unit_cost_cents: number | null;
};

export type SalePayload = {
  id: string;
  total_cents: number;
  tendered_cents: number | null;
  change_cents: number | null;
  actor_user_id: string;
  device_id: string;
  /** True for sales made before the shop was registered: recorded, but stock is not moved again. */
  imported: boolean;
  created_at: string;
  items: SaleItemPayload[];
};

export type ReversalItemPayload = {
  id: string;
  sale_item_id: string;
  quantity: number;
  restocked: boolean;
  refund_cents: number;
};

export type ReversalPayload = {
  id: string;
  sale_id: string;
  reason: string;
  refund_cents: number;
  actor_user_id: string;
  device_id: string;
  imported: boolean;
  created_at: string;
  items: ReversalItemPayload[];
};

/** Kinds pushed as their own op; sale and reversal movements are derived from those ops. */
export type StockMovementKind = "opening" | "restock" | "adjustment";

export type StockMovementPayload = {
  id: string;
  variant_id: string;
  delta: number;
  kind: StockMovementKind;
  actor_user_id: string;
  device_id: string;
  created_at: string;
};

export type EmbeddingSource = "photo" | "teach" | "correction";

/** A stored view of a product for visual matching (insert-only; it can be deleted). */
export type EmbeddingPayload = {
  id: string;
  product_id: string;
  model_version: string;
  source: EmbeddingSource;
  /** The image it was computed from (photo or correction crop), to re-derive on a new model. */
  image_sha256: string | null;
  dim: number;
  /** Base64 of `dim` little-endian float16 values of the L2-normalised vector. */
  vector_f16: string;
  created_at: string;
};

/** Payload of an embedding `delete` op. */
export type EmbeddingDeletePayload = { id: string };

/** Pull only: the server's stock for a size (may be negative). */
export type StockLevelRecord = { variant_id: string; stock: number };

/** Pull only: a view that was deleted. */
export type EmbeddingTombstone = { id: string; product_id: string; deleted: true };

/** One record from pull or snapshot: its current state, not the op that changed it. */
export type PulledRecord =
  | { entity: "products"; record: ProductPayload }
  | { entity: "sales"; record: SalePayload }
  | { entity: "reversals"; record: ReversalPayload }
  | { entity: "stock_levels"; record: StockLevelRecord }
  | { entity: "embeddings"; record: EmbeddingPayload | EmbeddingTombstone };

export type OpPayload = {
  products: ProductPayload;
  sales: SalePayload;
  reversals: ReversalPayload;
  stock_movements: StockMovementPayload;
  embeddings: EmbeddingPayload;
};
