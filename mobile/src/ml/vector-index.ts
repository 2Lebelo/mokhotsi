export type Candidate = { productId: string; score: number };

/**
 * In-memory cosine-similarity index over taught product views.
 *
 * Rows live in ONE contiguous row-major Float32Array with a parallel id array:
 * a query is a tight dot-product loop over a single buffer, and growth doubles the
 * capacity with one copy. Rows must be L2-normalised, so cosine = dot product.
 */
export class VectorIndex {
  readonly dim: number;
  private data: Float32Array;
  private ids: string[] = [];

  constructor(dim: number, capacity = 256) {
    if (!Number.isInteger(dim) || dim <= 0)
      throw new RangeError(`dim must be a positive integer, got ${dim}`);
    this.dim = dim;
    this.data = new Float32Array(Math.max(1, capacity) * dim);
  }

  get size(): number {
    return this.ids.length;
  }

  add(productId: string, vector: Float32Array): void {
    if (vector.length !== this.dim)
      throw new RangeError(
        `Vector has ${vector.length} values; the index expects ${this.dim}.`,
      );
    if ((this.ids.length + 1) * this.dim > this.data.length) {
      const grown = new Float32Array(this.data.length * 2);
      grown.set(this.data);
      this.data = grown;
    }
    this.data.set(vector, this.ids.length * this.dim);
    this.ids.push(productId);
  }

  /** The best `k` products for a normalised query, by each product's closest view. */
  topK(query: Float32Array, k: number): Candidate[] {
    if (query.length !== this.dim)
      throw new RangeError(
        `Query has ${query.length} values; the index expects ${this.dim}.`,
      );
    const best = new Map<string, number>();
    const { data, dim } = this;
    for (let row = 0; row < this.ids.length; row++) {
      const offset = row * dim;
      let score = 0;
      for (let i = 0; i < dim; i++) score += data[offset + i] * query[i];
      const id = this.ids[row];
      const previous = best.get(id);
      if (previous === undefined || score > previous) best.set(id, score);
    }
    return [...best]
      .map(([productId, score]) => ({ productId, score }))
      .sort((a, b) => b.score - a.score)
      .slice(0, k);
  }
}
