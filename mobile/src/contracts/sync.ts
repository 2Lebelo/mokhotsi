/**
 * TypeScript mirror of contracts/sync.schema.json (snake_case = wire format).
 * __tests__/contracts.test.ts fails if these types and the schema drift apart.
 */
import type { Cents } from '@/lib/money';

export type Uuid = string;
/** ISO 8601 UTC string. Informational only; never used for ordering. */
export type Timestamp = string;

export const ENTITY_VALUES = ['products', 'embeddings', 'sales'] as const;
export const OP_KIND_VALUES = ['upsert', 'delete'] as const;
export const MATCH_METHOD_VALUES = ['vision', 'barcode', 'manual'] as const;

export type Entity = (typeof ENTITY_VALUES)[number];
export type OpKind = (typeof OP_KIND_VALUES)[number];
export type MatchMethod = (typeof MATCH_METHOD_VALUES)[number];

export const PUSH_MAX_OPS = 200;
export const PULL_MAX_LIMIT = 500;

export interface Op {
  op_id: Uuid;
  entity: Entity;
  entity_id: Uuid;
  op: OpKind;
  /** Upsert: the record without `seq`. Delete: {}. */
  payload: Record<string, unknown>;
}

export interface PushRequest {
  device_id: Uuid;
  ops: Op[];
}

export interface Rejection {
  op_id: Uuid;
  reason: string;
}

export interface PushResponse {
  acked: Uuid[];
  rejected: Rejection[];
}

export interface ProductRecord {
  id: Uuid;
  name: string;
  price_cents: Cents;
  barcode: string | null;
  deleted: boolean;
  updated_at: Timestamp;
  seq: number;
}

export interface EmbeddingRecord {
  id: Uuid;
  product_id: Uuid;
  /** Base64 of `dim` little-endian float32 values, L2-normalised. */
  vector_b64: string;
  dim: number;
  model_version: string;
  deleted: boolean;
  created_at: Timestamp;
  seq: number;
}

export interface SaleItemRecord {
  id: Uuid;
  product_id: Uuid;
  qty: number;
  unit_price_cents: Cents;
  match_score: number | null;
  match_method: MatchMethod;
}

export interface SaleRecord {
  id: Uuid;
  device_id: Uuid;
  total_cents: Cents;
  items: SaleItemRecord[];
  deleted: boolean;
  created_at: Timestamp;
  seq: number;
}

export interface PullChanges {
  products: ProductRecord[];
  embeddings: EmbeddingRecord[];
  sales: SaleRecord[];
}

export interface PullResponse {
  changes: PullChanges;
  /** Opaque; send back as ?cursor= on the next pull. */
  next_cursor: string;
  has_more: boolean;
}

/** Exhaustive key lists, checked by the compiler against the interfaces above and by the
 *  contract test against the JSON Schema. */
export const CONTRACT_KEYS = {
  Op: { op_id: true, entity: true, entity_id: true, op: true, payload: true },
  PushRequest: { device_id: true, ops: true },
  Rejection: { op_id: true, reason: true },
  PushResponse: { acked: true, rejected: true },
  ProductRecord: {
    id: true,
    name: true,
    price_cents: true,
    barcode: true,
    deleted: true,
    updated_at: true,
    seq: true,
  },
  EmbeddingRecord: {
    id: true,
    product_id: true,
    vector_b64: true,
    dim: true,
    model_version: true,
    deleted: true,
    created_at: true,
    seq: true,
  },
  SaleItemRecord: {
    id: true,
    product_id: true,
    qty: true,
    unit_price_cents: true,
    match_score: true,
    match_method: true,
  },
  SaleRecord: {
    id: true,
    device_id: true,
    total_cents: true,
    items: true,
    deleted: true,
    created_at: true,
    seq: true,
  },
  PullChanges: { products: true, embeddings: true, sales: true },
  PullResponse: { changes: true, next_cursor: true, has_more: true },
} as const satisfies {
  Op: Record<keyof Op, true>;
  PushRequest: Record<keyof PushRequest, true>;
  Rejection: Record<keyof Rejection, true>;
  PushResponse: Record<keyof PushResponse, true>;
  ProductRecord: Record<keyof ProductRecord, true>;
  EmbeddingRecord: Record<keyof EmbeddingRecord, true>;
  SaleItemRecord: Record<keyof SaleItemRecord, true>;
  SaleRecord: Record<keyof SaleRecord, true>;
  PullChanges: Record<keyof PullChanges, true>;
  PullResponse: Record<keyof PullResponse, true>;
};
