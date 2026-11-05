export type Candidate = { productId: string; score: number };

/** Rows kept at most (~15 MB at 1280 dims): enough for ~1,000 products on a 2 GB phone. */
export const MAX_INDEX_ROWS = 12_000;

/**
 * In-memory cosine-similarity index over stored product views.
 *
 * Rows are quantised to int8 with one float scale per row (row ≈ scale × q), a quarter of
 * the memory of float32, in ONE contiguous row-major buffer with a parallel id array: a query
 * is a tight dot-product loop over a single buffer, and growth doubles the capacity with one
 * copy. The query stays float32; the ranking error is around 1e-3, far below the gaps that
 * separate products. Rows must be L2-normalised, so cosine = dot product.
 *
 * The index stops accepting rows at `maxRows`, so callers add the views that matter most
 * first (see EmbeddingsRepository.eachVector).
 */
export class VectorIndex {
  readonly dim: number;
  readonly maxRows: number;
  private data: Int8Array;
  private scales: Float32Array;
  private ids: string[] = [];

  constructor(dim: number, capacity = 256, maxRows = MAX_INDEX_ROWS) {
    if (!Number.isInteger(dim) || dim <= 0)
      throw new RangeError(`dim must be a positive integer, got ${dim}`);
    this.dim = dim;
    this.maxRows = maxRows;
    const rows = Math.max(1, Math.min(capacity, maxRows));
    this.data = new Int8Array(rows * dim);
    this.scales = new Float32Array(rows);
  }

  get size(): number {
    return this.ids.length;
  }

  get full(): boolean {
    return this.ids.length >= this.maxRows;
  }

  /** Adds a view; false once the index is full. */
  add(productId: string, vector: Float32Array): boolean {
    if (vector.length !== this.dim)
      throw new RangeError(
        `Vector has ${vector.length} values; the index expects ${this.dim}.`,
      );
    return this.push(productId, (i) => vector[i]);
  }

  /** Adds a view straight from its stored blob (little-endian float32, see vector.ts). */
  addBlob(productId: string, blob: Uint8Array): boolean {
    if (blob.byteLength !== this.dim * 4)
      throw new RangeError(
        `A stored vector has ${blob.byteLength} bytes; the index expects ${this.dim * 4}.`,
      );
    const view = new DataView(blob.buffer, blob.byteOffset, blob.byteLength);
    return this.push(productId, (i) => view.getFloat32(i * 4, true));
  }

  private push(productId: string, value: (i: number) => number): boolean {
    if (this.full) return false;
    const row = this.ids.length;
    if (row >= this.scales.length) this.grow();
    const { dim } = this;
    let max = 0;
    for (let i = 0; i < dim; i++) max = Math.max(max, Math.abs(value(i)));
    const scale = max / 127;
    const offset = row * dim;
    if (scale > 0)
      for (let i = 0; i < dim; i++)
        this.data[offset + i] = Math.round(value(i) / scale);
    this.scales[row] = scale;
    this.ids.push(productId);
    return true;
  }

  private grow(): void {
    const rows = Math.min(this.scales.length * 2, this.maxRows);
    const data = new Int8Array(rows * this.dim);
    data.set(this.data);
    this.data = data;
    const scales = new Float32Array(rows);
    scales.set(this.scales);
    this.scales = scales;
  }

  /** The best `k` products for a normalised query, by each product's closest view. */
  topK(query: Float32Array, k: number): Candidate[] {
    if (query.length !== this.dim)
      throw new RangeError(
        `Query has ${query.length} values; the index expects ${this.dim}.`,
      );
    const best = new Map<string, number>();
    const { data, dim, scales } = this;
    for (let row = 0; row < this.ids.length; row++) {
      const offset = row * dim;
      let sum = 0;
      for (let i = 0; i < dim; i++) sum += data[offset + i] * query[i];
      const score = sum * scales[row];
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
