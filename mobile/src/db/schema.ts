import { customType, index, integer, real, sqliteTable, text } from 'drizzle-orm/sqlite-core';

// Relative import: drizzle-kit loads this file outside Metro/TS path aliases.
import { ENTITY_VALUES, MATCH_METHOD_VALUES, OP_KIND_VALUES } from '../contracts/sync';

/**
 * Local SQLite schema (Drizzle). Conventions:
 * - ids are client-generated UUID v4 strings (src/lib/ids.ts);
 * - money is integer cents;
 * - timestamps are epoch milliseconds (informational only: sync order comes from the
 *   server-assigned per-shop `seq`, never from this clock).
 * After editing, run `npm run db:generate` and commit the new files in ./drizzle.
 */

/** Float32 vector stored as a raw little-endian BLOB (expo-sqlite returns BLOBs as Uint8Array). */
const float32Vector = customType<{ data: Float32Array; driverData: Uint8Array }>({
  dataType: () => 'blob',
  toDriver: (value) => new Uint8Array(value.buffer, value.byteOffset, value.byteLength),
  // Copy into a fresh, 4-byte-aligned buffer before viewing as float32.
  fromDriver: (value) => new Float32Array(value.slice().buffer),
});

export const products = sqliteTable(
  'products',
  {
    id: text('id').primaryKey(),
    shopId: text('shop_id').notNull(),
    name: text('name').notNull(),
    priceCents: integer('price_cents').notNull(),
    barcode: text('barcode'),
    updatedAt: integer('updated_at').notNull(),
    deleted: integer('deleted', { mode: 'boolean' }).notNull().default(false),
  },
  (t) => [
    index('products_shop_updated_idx').on(t.shopId, t.updatedAt),
    index('products_shop_barcode_idx').on(t.shopId, t.barcode),
  ],
);

export const embeddings = sqliteTable(
  'embeddings',
  {
    id: text('id').primaryKey(),
    productId: text('product_id')
      .notNull()
      .references(() => products.id),
    vector: float32Vector('vector').notNull(),
    dim: integer('dim').notNull(),
    modelVersion: text('model_version').notNull(),
    createdAt: integer('created_at').notNull(),
  },
  (t) => [
    index('embeddings_product_idx').on(t.productId),
    // The VectorIndex is loaded per model version at startup.
    index('embeddings_model_idx').on(t.modelVersion),
  ],
);

export const productImages = sqliteTable(
  'product_images',
  {
    id: text('id').primaryKey(),
    productId: text('product_id')
      .notNull()
      .references(() => products.id),
    localUri: text('local_uri').notNull(),
  },
  (t) => [index('product_images_product_idx').on(t.productId)],
);

export const sales = sqliteTable(
  'sales',
  {
    id: text('id').primaryKey(),
    shopId: text('shop_id').notNull(),
    totalCents: integer('total_cents').notNull(),
    createdAt: integer('created_at').notNull(),
    deviceId: text('device_id').notNull(),
  },
  (t) => [index('sales_shop_created_idx').on(t.shopId, t.createdAt)],
);

export const saleItems = sqliteTable(
  'sale_items',
  {
    id: text('id').primaryKey(),
    saleId: text('sale_id')
      .notNull()
      .references(() => sales.id),
    productId: text('product_id')
      .notNull()
      .references(() => products.id),
    qty: integer('qty').notNull(),
    unitPriceCents: integer('unit_price_cents').notNull(),
    matchScore: real('match_score'),
    matchMethod: text('match_method', { enum: MATCH_METHOD_VALUES }).notNull(),
  },
  (t) => [index('sale_items_sale_idx').on(t.saleId), index('sale_items_product_idx').on(t.productId)],
);

/** Every local write inserts one row here in the same transaction (see ADR 0001). */
export const outbox = sqliteTable(
  'outbox',
  {
    opId: text('op_id').primaryKey(),
    entity: text('entity', { enum: ENTITY_VALUES }).notNull(),
    entityId: text('entity_id').notNull(),
    op: text('op', { enum: OP_KIND_VALUES }).notNull(),
    /** JSON-encoded payload, shaped per contracts/sync.schema.json. */
    payload: text('payload').notNull(),
    createdAt: integer('created_at').notNull(),
    attempts: integer('attempts').notNull().default(0),
    /**
     * Set when the server rejected the op (`<code>: <message>`). Rejected rows stay out of
     * push batches and are listed under "needs attention" until retried or discarded.
     */
    rejectedReason: text('rejected_reason'),
    rejectedAt: integer('rejected_at'),
  },
  (t) => [index('outbox_created_idx').on(t.createdAt), index('outbox_entity_idx').on(t.entity, t.entityId)],
);

/** Small key/value store: pull cursor, device id, last sync time, … */
export const syncState = sqliteTable('sync_state', {
  key: text('key').primaryKey(),
  value: text('value').notNull(),
});

/** On-device timings (detect/embed/match latency, sync durations) for the debug screen. */
export const metrics = sqliteTable(
  'metrics',
  {
    id: text('id').primaryKey(),
    kind: text('kind').notNull(),
    valueMs: real('value_ms').notNull(),
    /** Optional JSON-encoded context. */
    meta: text('meta'),
    createdAt: integer('created_at').notNull(),
  },
  (t) => [index('metrics_kind_created_idx').on(t.kind, t.createdAt)],
);

export type Product = typeof products.$inferSelect;
export type NewProduct = typeof products.$inferInsert;
export type Embedding = typeof embeddings.$inferSelect;
export type NewEmbedding = typeof embeddings.$inferInsert;
export type ProductImage = typeof productImages.$inferSelect;
export type Sale = typeof sales.$inferSelect;
export type NewSale = typeof sales.$inferInsert;
export type SaleItem = typeof saleItems.$inferSelect;
export type NewSaleItem = typeof saleItems.$inferInsert;
export type OutboxRow = typeof outbox.$inferSelect;
export type Metric = typeof metrics.$inferSelect;
