import { notImplemented } from '@/lib/errors';

import type { Match } from './types';

/** Packed vectors as returned by the embeddings repository (row i ↔ productIds[i]). */
export interface PackedVectors {
  dim: number;
  productIds: readonly string[];
  vectors: Float32Array;
}

/**
 * In-memory cosine-similarity index over the shop's enrolled vectors.
 *
 * Layout: ONE contiguous row-major Float32Array (`capacity × dim`) plus a parallel id array.
 * No per-vector objects: a scan is a tight dot-product loop over one buffer, and growth
 * doubles capacity with a single copy. Vectors are L2-normalised, so cosine = dot product.
 */
export class VectorIndex {
  readonly dim: number;
  private data: Float32Array;
  private ids: string[] = [];
  private count = 0;

  constructor(dim: number, initialCapacity = 256) {
    if (!Number.isInteger(dim) || dim <= 0)
      throw new RangeError(`dim must be a positive integer, got ${dim}`);
    this.dim = dim;
    this.data = new Float32Array(Math.max(1, initialCapacity) * dim);
  }

  get size(): number {
    return this.count;
  }

  /** Replace the whole index with vectors loaded from SQLite. */
  load(packed: PackedVectors): void {
    // TODO(feature): validate packed.dim === this.dim and lengths; adopt or copy packed.vectors; set ids/count.
    notImplemented(
      `VectorIndex.load (${packed.productIds.length} vectors, ${this.data.length} floats allocated)`,
    );
  }

  /** Append one L2-normalised vector for `productId` (after enrolment). */
  add(productId: string, vector: Float32Array): void {
    // TODO(feature): grow (double) when full, copy vector into row `count`, push id.
    notImplemented(`VectorIndex.add (${productId}, ${vector.length}, ids ${this.ids.length})`);
  }

  /**
   * Best `k` matches for an L2-normalised query, highest score first, best score per product.
   * Callers compare the top score with manifest.match_threshold.
   */
  topK(query: Float32Array, k: number): Match[] {
    // TODO(feature): linear dot-product scan over data[0 .. count*dim), keep a k-sized min-heap, dedupe by product.
    return notImplemented(`VectorIndex.topK (query ${query.length}, k ${k})`);
  }
}
