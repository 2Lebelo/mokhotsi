import type { SQLiteDatabase } from "expo-sqlite";

import { fromBlob, toBlob } from "../../ml/vector.ts";
import type {
  EmbeddingInput,
  EmbeddingSource,
  StaleEmbedding,
} from "../types.ts";
import type { IdFactory } from "./shared.ts";

/**
 * Stored product views for visual matching. Work that is still pending (photos not yet embedded,
 * views from an older model) is derived from this table and `products`, so there
 * is no job queue to drift out of sync with the data.
 */
export class EmbeddingsRepository {
  private db: SQLiteDatabase;
  private newId: IdFactory;

  constructor(db: SQLiteDatabase, newId: IdFactory) {
    this.db = db;
    this.newId = newId;
  }

  add(input: EmbeddingInput): string {
    const id = this.newId();
    this.db.runSync(
      "INSERT INTO product_embeddings (id, product_id, model_version, vector, source, image_uri, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
      id,
      input.productId,
      input.modelVersion,
      toBlob(input.vector),
      input.source,
      input.imageUri,
      new Date().toISOString(),
    );
    return id;
  }

  /** Every vector for one model version, for building the in-memory index. */
  vectors(modelVersion: string): { productId: string; vector: Float32Array }[] {
    return this.db
      .getAllSync<{
        product_id: string;
        vector: Uint8Array;
      }>(
        "SELECT product_id, vector FROM product_embeddings WHERE model_version = ? ORDER BY product_id",
        modelVersion,
      )
      .map((row) => ({
        productId: row.product_id,
        vector: fromBlob(row.vector),
      }));
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
  ): { productId: string; photoUri: string }[] {
    return this.db
      .getAllSync<{ id: string; photo_uri: string }>(
        `SELECT p.id, p.photo_uri FROM (
           SELECT id, photo_uri, updated_at, 0 AS slot FROM products WHERE photo_uri IS NOT NULL
           UNION ALL
           SELECT id, photo2_uri, updated_at, 1 AS slot FROM products WHERE photo2_uri IS NOT NULL
         ) p
         WHERE NOT EXISTS (
           SELECT 1 FROM product_embeddings e
           WHERE e.product_id = p.id AND e.source = 'photo'
             AND e.model_version = ? AND e.image_uri = p.photo_uri)
         ORDER BY p.updated_at DESC, p.id, p.slot`,
        modelVersion,
      )
      .map((row) => ({ productId: row.id, photoUri: row.photo_uri }));
  }

  /**
   * Replaces the vectors of one product photo (several crops of the same image),
   * leaving the product's other photo untouched.
   */
  replacePhoto(input: {
    productId: string;
    modelVersion: string;
    imageUri: string;
    vectors: readonly Float32Array[];
  }): void {
    if (!input.vectors.length)
      throw new Error("A photo needs at least one vector.");
    this.db.withTransactionSync(() => {
      this.db.runSync(
        "DELETE FROM product_embeddings WHERE product_id = ? AND source = 'photo' AND image_uri = ?",
        input.productId,
        input.imageUri,
      );
      for (const vector of input.vectors)
        this.add({
          productId: input.productId,
          modelVersion: input.modelVersion,
          vector,
          source: "photo",
          imageUri: input.imageUri,
        });
    });
  }

  /** Drops photo vectors whose photo was replaced or removed, or whose model is outdated. */
  removeStalePhotos(modelVersion: string): number {
    return this.db.runSync(
      `DELETE FROM product_embeddings WHERE source = 'photo' AND (
         model_version <> ? OR NOT EXISTS (
           SELECT 1 FROM products p
           WHERE p.id = product_embeddings.product_id
             AND (p.photo_uri = product_embeddings.image_uri
               OR p.photo2_uri = product_embeddings.image_uri)))`,
      modelVersion,
    ).changes;
  }

  /** Saved-crop views (legacy captures, corrections) from older models that can be re-embedded from their crop. */
  stale(modelVersion: string, limit: number): StaleEmbedding[] {
    return this.db.getAllSync<StaleEmbedding>(
      `SELECT id, product_id, source, image_uri FROM product_embeddings
       WHERE source <> 'photo' AND model_version <> ? AND image_uri IS NOT NULL
       ORDER BY created_at LIMIT ?`,
      modelVersion,
      limit,
    );
  }

  /** Swaps an outdated view for its re-embedded version in one transaction. */
  replaceStale(staleId: string, input: EmbeddingInput): void {
    this.db.withTransactionSync(() => {
      this.db.runSync("DELETE FROM product_embeddings WHERE id = ?", staleId);
      this.add(input);
    });
  }

  /** Deletes one view, e.g. an outdated one whose source image is gone. */
  removeById(id: string): void {
    this.db.runSync("DELETE FROM product_embeddings WHERE id = ?", id);
  }

  /** Deletes views and returns the image files that belonged only to them. */
  remove(productId: string, source: EmbeddingSource): string[] {
    let uris: string[] = [];
    this.db.withTransactionSync(() => {
      uris = this.db
        .getAllSync<{
          image_uri: string;
        }>(
          "SELECT image_uri FROM product_embeddings WHERE product_id = ? AND source = ? AND image_uri IS NOT NULL",
          productId,
          source,
        )
        .map((row) => row.image_uri);
      this.db.runSync(
        "DELETE FROM product_embeddings WHERE product_id = ? AND source = ?",
        productId,
        source,
      );
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
      for (const row of old)
        this.db.runSync("DELETE FROM product_embeddings WHERE id = ?", row.id);
      uris = old.flatMap((row) => (row.image_uri ? [row.image_uri] : []));
    });
    return uris;
  }
}
