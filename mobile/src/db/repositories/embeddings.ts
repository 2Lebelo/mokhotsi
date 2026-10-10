import { asc, eq } from 'drizzle-orm';

import { float32ToBase64 } from '@/lib/base64';
import { newId, type Uuid } from '@/lib/ids';
import { msToIso } from '@/lib/time';
import { db } from '@/db/client';
import { notifyChanged } from '@/db/changes';
import { embeddings, type Embedding } from '@/db/schema';

import { enqueue } from './outbox';

/** All vectors of one model version, packed for the VectorIndex (src/ml/matcher.ts). */
export interface EmbeddingMatrix {
  modelVersion: string;
  dim: number;
  /** Row i belongs to productIds[i]. */
  productIds: Uuid[];
  /** One contiguous row-major buffer: productIds.length × dim float32 values. */
  vectors: Float32Array;
}

/** Wire payload for `embeddings/upsert` (contracts EmbeddingRecord without `seq`). */
export function embeddingPayload(e: Embedding): Record<string, unknown> {
  return {
    id: e.id,
    product_id: e.productId,
    vector_b64: float32ToBase64(e.vector),
    dim: e.dim,
    model_version: e.modelVersion,
    deleted: false,
    created_at: msToIso(e.createdAt),
  };
}

/**
 * Store 1–3 enrolment vectors for a product AND enqueue one `embeddings/upsert` op per vector,
 * in one transaction. Vectors must already be L2-normalised and all the same length.
 */
export function addEmbeddings(
  productId: Uuid,
  vectors: readonly Float32Array[],
  modelVersion: string,
): Embedding[] {
  const dim = vectors[0]?.length ?? 0;
  if (dim === 0) throw new TypeError('at least one non-empty vector is required');
  if (vectors.some((v) => v.length !== dim)) throw new TypeError('all vectors must have the same dim');
  const now = Date.now();
  const rows: Embedding[] = vectors.map((v) => ({
    id: newId(),
    productId,
    vector: Float32Array.from(v),
    dim,
    modelVersion,
    createdAt: now,
  }));
  db.transaction((tx) => {
    for (const row of rows) {
      tx.insert(embeddings).values(row).run();
      enqueue(tx, { entity: 'embeddings', entityId: row.id, op: 'upsert', payload: embeddingPayload(row) });
    }
  });
  notifyChanged('embeddings', 'outbox');
  return rows;
}

/** Delete a product's embeddings (re-enrolment) AND enqueue `embeddings/delete` ops. */
export function deleteEmbeddingsForProduct(productId: Uuid): void {
  db.transaction((tx) => {
    const ids = tx
      .select({ id: embeddings.id })
      .from(embeddings)
      .where(eq(embeddings.productId, productId))
      .all()
      .map((r) => r.id);
    if (ids.length === 0) return;
    tx.delete(embeddings).where(eq(embeddings.productId, productId)).run();
    for (const id of ids) enqueue(tx, { entity: 'embeddings', entityId: id, op: 'delete', payload: {} });
  });
  notifyChanged('embeddings', 'outbox');
}

/** Read every vector for `modelVersion` into one contiguous Float32Array (no per-row arrays). */
export function loadMatrix(modelVersion: string, dim: number): EmbeddingMatrix {
  const rows = db
    .select({ productId: embeddings.productId, vector: embeddings.vector, dim: embeddings.dim })
    .from(embeddings)
    .where(eq(embeddings.modelVersion, modelVersion))
    .orderBy(asc(embeddings.productId), asc(embeddings.id))
    .all()
    .filter((r) => r.dim === dim && r.vector.length === dim);
  const vectors = new Float32Array(rows.length * dim);
  rows.forEach((r, i) => vectors.set(r.vector, i * dim));
  return { modelVersion, dim, productIds: rows.map((r) => r.productId), vectors };
}
