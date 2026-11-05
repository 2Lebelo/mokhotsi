import type { SQLiteDatabase } from "expo-sqlite";

import type { EmbeddingPayload } from "../../contracts/sync.ts";
import { encodeF16 } from "../../ml/float16.ts";
import { fromBlob, toBlob } from "../../ml/vector.ts";
import type {
  EmbeddingInput,
  EmbeddingSource,
  StaleEmbedding,
} from "../types.ts";
import type { OutboxRepository } from "./outbox.ts";
import type { StoreContext } from "./shared.ts";

type EmbeddingRow = {
  id: string;
  product_id: string;
  model_version: string;
  vector: Uint8Array;
  source: EmbeddingSource;
  image_uri: string | null;
  image_sha256: string | null;
  created_at: string;
};

/**
 * Stored product views for visual matching. Work that is still pending (photos not yet embedded,
 * views from an older model) is derived from this table and `products`, so there
 * is no job queue to drift out of sync with the data.
 *
 * Views of the current model are synced: adding one queues it and removing one queues its
 * deletion, in the same transaction. Views of older models are only ever dropped here, since
 * phones still on that model keep using them.
 */
export class EmbeddingsRepository {
  private db: SQLiteDatabase;
  private context: StoreContext;
  private outbox: OutboxRepository;

  constructor(db: SQLiteDatabase, context: StoreContext, outbox: OutboxRepository) {
    this.db = db;
    this.context = context;
    this.outbox = outbox;
  }

  /** Stores one view (and queues it). */
  add(input: EmbeddingInput): string {
    let id = "";
    this.db.withTransactionSync(() => {
      id = this.insert(input);
    });
    return id;
  }

  /** Inside a transaction. A view with a derived id that is already stored is left alone. */
  private insert(input: EmbeddingInput): string {
    const id = input.id ?? this.context.newId();
    const createdAt = this.context.clock().toISOString();
    const inserted = this.db.runSync(
      "INSERT OR IGNORE INTO product_embeddings (id, product_id, model_version, vector, source, image_uri, image_sha256, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
      id,
      input.productId,
      input.modelVersion,
      toBlob(input.vector),
      input.source,
      input.imageUri,
      input.imageSha256 ?? null,
      createdAt,
    );
    if (inserted.changes)
      this.outbox.record("embeddings", id, {
        id,
        product_id: input.productId,
        model_version: input.modelVersion,
        source: input.source,
        image_sha256: input.imageSha256 ?? null,
        dim: input.vector.length,
        vector_f16: encodeF16(input.vector),
        created_at: createdAt,
      });
    return id;
  }

  /** Inside a transaction: deletes views and queues their deletion. */
  private delete(ids: readonly string[]): void {
    for (const id of ids) {
      this.db.runSync("DELETE FROM product_embeddings WHERE id = ?", id);
      this.outbox.recordDelete("embeddings", id);
    }
  }

  /** How many vectors one model version has. */
  count(modelVersion: string): number {
    return (
      this.db.getFirstSync<{ n: number }>(
        "SELECT COUNT(*) AS n FROM product_embeddings WHERE model_version = ?",
        modelVersion,
      )?.n ?? 0
    );
  }

  /**
   * Streams the vectors of one model version as stored blobs (float32, see ml/vector.ts), for
   * building the in-memory index without holding every row at once. Product photos come
   * first, then corrections newest first, so a capped index keeps the views that matter
   * most. Stops when `visit` returns false.
   */
  eachVector(
    modelVersion: string,
    visit: (productId: string, blob: Uint8Array) => boolean,
  ): void {
    const rows = this.db.getEachSync<{ product_id: string; vector: Uint8Array }>(
      `SELECT product_id, vector FROM product_embeddings WHERE model_version = ?
       ORDER BY source = 'correction', created_at DESC, id`,
      modelVersion,
    );
    for (const row of rows) if (!visit(row.product_id, row.vector)) break;
  }

  /** Every vector for one model version, decoded (tests and tools; the app streams). */
  vectors(modelVersion: string): { productId: string; vector: Float32Array }[] {
    const all: { productId: string; vector: Float32Array }[] = [];
    this.eachVector(modelVersion, (productId, blob) => {
      all.push({ productId, vector: fromBlob(blob) });
      return true;
    });
    return all;
  }

  /** Stored views per product, in one query. */
  countsByProduct(modelVersion: string): Map<string, number> {
    return new Map(
      this.db
        .getAllSync<{
          product_id: string;
          views: number;
        }>(
          "SELECT product_id, COUNT(*) AS views FROM product_embeddings WHERE model_version = ? GROUP BY product_id",
          modelVersion,
        )
        .map((row) => [row.product_id, row.views]),
    );
  }

  /** Stored views of one product. */
  viewCount(productId: string, modelVersion: string): number {
    return (
      this.db.getFirstSync<{ views: number }>(
        "SELECT COUNT(*) AS views FROM product_embeddings WHERE product_id = ? AND model_version = ?",
        productId,
        modelVersion,
      )?.views ?? 0
    );
  }

  /** Product photos (main and second) with no vector for this model version yet. */
  pendingPhotos(
    modelVersion: string,
  ): { productId: string; photoUri: string; photoSha: string | null }[] {
    return this.db
      .getAllSync<{ id: string; photo_uri: string; photo_sha: string | null }>(
        `SELECT p.id, p.photo_uri, p.photo_sha FROM (
           SELECT id, photo_uri, photo_hash AS photo_sha, updated_at, 0 AS slot
             FROM products WHERE photo_uri IS NOT NULL
           UNION ALL
           SELECT id, photo2_uri, photo2_hash, updated_at, 1 AS slot
             FROM products WHERE photo2_uri IS NOT NULL
         ) p
         WHERE NOT EXISTS (
           SELECT 1 FROM product_embeddings e
           WHERE e.product_id = p.id AND e.source = 'photo'
             AND e.model_version = ? AND e.image_uri = p.photo_uri)
         ORDER BY p.updated_at DESC, p.id, p.slot`,
        modelVersion,
      )
      .map((row) => ({
        productId: row.id,
        photoUri: row.photo_uri,
        photoSha: row.photo_sha,
      }));
  }

  /**
   * Replaces the vectors of one product photo (several crops of the same image), leaving the
   * product's other photo untouched. With derived `ids` (one per vector, see sync/ids.ts) a
   * view that is already stored is kept as it is, so re-embedding never churns the server.
   */
  replacePhoto(input: {
    productId: string;
    modelVersion: string;
    imageUri: string;
    imageSha256?: string | null;
    vectors: readonly Float32Array[];
    ids?: readonly string[];
  }): void {
    if (!input.vectors.length)
      throw new Error("A photo needs at least one vector.");
    if (input.ids && input.ids.length !== input.vectors.length)
      throw new Error("Each vector needs its own id.");
    this.db.withTransactionSync(() => {
      const keep = new Set(input.ids ?? []);
      const old = this.db
        .getAllSync<{ id: string }>(
          "SELECT id FROM product_embeddings WHERE product_id = ? AND source = 'photo' AND image_uri = ? AND model_version = ?",
          input.productId,
          input.imageUri,
          input.modelVersion,
        )
        .map((row) => row.id)
        .filter((id) => !keep.has(id));
      this.delete(old);
      input.vectors.forEach((vector, n) =>
        this.insert({
          id: input.ids?.[n],
          productId: input.productId,
          modelVersion: input.modelVersion,
          vector,
          source: "photo",
          imageUri: input.imageUri,
          imageSha256: input.imageSha256,
        }),
      );
    });
  }

  /**
   * Drops photo vectors that no longer apply: those of older models (here only) and those
   * whose photo was replaced or removed (deleted on the server too). Returns how many.
   */
  removeStalePhotos(modelVersion: string): number {
    let removed = 0;
    this.db.withTransactionSync(() => {
      removed += this.db.runSync(
        "DELETE FROM product_embeddings WHERE source = 'photo' AND model_version <> ?",
        modelVersion,
      ).changes;
      const orphans = this.db
        .getAllSync<{ id: string }>(
          `SELECT id FROM product_embeddings e
           WHERE source = 'photo' AND model_version = ? AND NOT EXISTS (
             SELECT 1 FROM products p
             WHERE p.id = e.product_id
               AND (p.photo_uri = e.image_uri OR p.photo2_uri = e.image_uri))`,
          modelVersion,
        )
        .map((row) => row.id);
      this.delete(orphans);
      removed += orphans.length;
    });
    return removed;
  }

  /** Saved-crop views (legacy captures, corrections) from older models that can be re-embedded from their crop. */
  stale(modelVersion: string, limit: number): StaleEmbedding[] {
    return this.db.getAllSync<StaleEmbedding>(
      `SELECT id, product_id, source, image_uri, image_sha256 FROM product_embeddings
       WHERE source <> 'photo' AND model_version <> ? AND image_uri IS NOT NULL
       ORDER BY created_at LIMIT ?`,
      modelVersion,
      limit,
    );
  }

  /** Swaps an outdated view for its re-embedded version in one transaction. */
  replaceStale(staleId: string, input: EmbeddingInput): void {
    this.db.withTransactionSync(() => {
      this.forget(staleId);
      this.insert(input);
    });
  }

  /** Drops a view of an older model here only (other phones may still use it). */
  forget(id: string): void {
    this.db.runSync("DELETE FROM product_embeddings WHERE id = ?", id);
  }

  /** Deletes views and returns the image files that belonged only to them. */
  remove(productId: string, source: EmbeddingSource): string[] {
    let uris: string[] = [];
    this.db.withTransactionSync(() => {
      const rows = this.db.getAllSync<{ id: string; image_uri: string | null }>(
        "SELECT id, image_uri FROM product_embeddings WHERE product_id = ? AND source = ?",
        productId,
        source,
      );
      this.delete(rows.map((row) => row.id));
      uris = rows.flatMap((row) => (row.image_uri ? [row.image_uri] : []));
    });
    return uris;
  }

  /**
   * Keeps only the newest `keep` correction views of a product, bounding how far
   * the index grows from till corrections. Returns the image files to delete.
   */
  pruneCorrections(productId: string, keep: number): string[] {
    let uris: string[] = [];
    this.db.withTransactionSync(() => {
      const old = this.db.getAllSync<{ id: string; image_uri: string | null }>(
        `SELECT id, image_uri FROM product_embeddings
         WHERE product_id = ? AND source = 'correction'
         ORDER BY created_at DESC, id DESC LIMIT -1 OFFSET ?`,
        productId,
        keep,
      );
      this.delete(old.map((row) => row.id));
      uris = old.flatMap((row) => (row.image_uri ? [row.image_uri] : []));
    });
    return uris;
  }

  /** Inside a transaction: queues every view of the model, for a shop's first upload. */
  queueAll(modelVersion: string): void {
    for (const row of this.db.getAllSync<EmbeddingRow>(
      "SELECT * FROM product_embeddings WHERE model_version = ? ORDER BY created_at, id",
      modelVersion,
    ))
      this.outbox.record("embeddings", row.id, this.payload(row));
  }

  /** Inside a transaction: records the hash of an image the views were computed from. */
  setImageHash(imageUri: string, sha256: string): void {
    this.db.runSync(
      "UPDATE product_embeddings SET image_sha256 = ? WHERE image_uri = ? AND image_sha256 IS NULL",
      sha256,
      imageUri,
    );
  }

  /** Crop images (not product photos) that have no hash yet, for the first upload. */
  unhashedCrops(): string[] {
    return this.db
      .getAllSync<{ image_uri: string }>(
        "SELECT DISTINCT image_uri FROM product_embeddings WHERE source <> 'photo' AND image_uri IS NOT NULL AND image_sha256 IS NULL",
      )
      .map((row) => row.image_uri);
  }

  private payload(row: EmbeddingRow): EmbeddingPayload {
    const vector = fromBlob(row.vector);
    return {
      id: row.id,
      product_id: row.product_id,
      model_version: row.model_version,
      source: row.source,
      image_sha256: row.image_sha256,
      dim: vector.length,
      vector_f16: encodeF16(vector),
      created_at: row.created_at,
    };
  }
}
