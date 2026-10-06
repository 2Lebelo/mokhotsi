import type { Uuid } from '@/lib/ids';
import { notImplemented } from '@/lib/errors';
import type { Embedding } from '@/db/schema';

/** All vectors of one model version, packed for the VectorIndex (src/ml/matcher.ts). */
export interface EmbeddingMatrix {
  modelVersion: string;
  dim: number;
  /** Row i belongs to productIds[i]. */
  productIds: Uuid[];
  /** One contiguous row-major buffer: productIds.length × dim float32 values. */
  vectors: Float32Array;
}

/**
 * Store 1–3 enrolment vectors for a product AND enqueue one `embeddings/upsert` op per vector,
 * in one transaction. Vectors must already be L2-normalised and `dim` long.
 */
export function addEmbeddings(
  productId: Uuid,
  vectors: readonly Float32Array[],
  modelVersion: string,
): Embedding[] {
  // TODO(feature): one db.transaction: insert each embedding row + enqueue(tx, …) with base64 vector payload.
  return notImplemented('embeddings.addEmbeddings');
}

/** Delete a product's embeddings (e.g. re-enrolment) AND enqueue `embeddings/delete` ops. */
export function deleteEmbeddingsForProduct(productId: Uuid): void {
  // TODO(feature): one transaction: delete rows + enqueue a delete op per removed id.
  return notImplemented('embeddings.deleteEmbeddingsForProduct');
}

/** Read every vector for `modelVersion` into one contiguous Float32Array (no per-row arrays). */
export function loadMatrix(modelVersion: string, dim: number): EmbeddingMatrix {
  // TODO(feature): select product_id, vector where model_version = ? (embeddings_model_idx); copy rows into one Float32Array.
  return notImplemented('embeddings.loadMatrix');
}
