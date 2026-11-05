import type { SQLiteDatabase } from "expo-sqlite";

import type { SyncedFile } from "../types.ts";
import type { StoreContext } from "./shared.ts";

/**
 * Images this shop syncs, by content hash: which file holds each one on this phone, and
 * whether it still has to be uploaded (`local`) or downloaded (`missing`).
 */
export class SyncedFilesRepository {
  private db: SQLiteDatabase;
  private context: StoreContext;

  constructor(db: SQLiteDatabase, context: StoreContext) {
    this.db = db;
    this.context = context;
  }

  get(sha256: string): SyncedFile | null {
    return this.db.getFirstSync<SyncedFile>(
      "SELECT sha256, kind, uri, state FROM files WHERE sha256 = ?",
      sha256,
    );
  }

  /**
   * Adds every hashed image the shop's data refers to (product photos, crops of stored
   * views) that is not tracked yet, as saved here and still to upload. Saving a product or a
   * correction only records the hash, so this is the one place images join the sync.
   */
  adoptReferenced(): void {
    this.db.runSync(
      `INSERT OR IGNORE INTO files (sha256, kind, uri, state, updated_at)
       SELECT photo_hash, 'photo', photo_uri, 'local', ? FROM products
         WHERE photo_hash IS NOT NULL AND photo_uri IS NOT NULL
       UNION ALL
       SELECT photo2_hash, 'photo', photo2_uri, 'local', ? FROM products
         WHERE photo2_hash IS NOT NULL AND photo2_uri IS NOT NULL
       UNION ALL
       SELECT image_sha256, 'crop', image_uri, 'local', ? FROM product_embeddings
         WHERE source <> 'photo' AND image_sha256 IS NOT NULL AND image_uri IS NOT NULL`,
      this.now(),
      this.now(),
      this.now(),
    );
  }

  /**
   * An image another phone synced: where it will be stored here. A known image keeps its
   * file, so a phone never downloads what it already has.
   */
  expect(sha256: string, kind: SyncedFile["kind"], uri: string): string {
    const known = this.get(sha256);
    if (known) return known.uri;
    this.db.runSync(
      "INSERT INTO files (sha256, kind, uri, state, updated_at) VALUES (?, ?, ?, 'missing', ?)",
      sha256,
      kind,
      uri,
      this.now(),
    );
    return uri;
  }

  inState(state: SyncedFile["state"], limit: number): SyncedFile[] {
    return this.db.getAllSync<SyncedFile>(
      "SELECT sha256, kind, uri, state FROM files WHERE state = ? ORDER BY updated_at LIMIT ?",
      state,
      limit,
    );
  }

  markUploaded(sha256: string): void {
    this.setState(sha256, "uploaded");
  }

  markDownloaded(sha256: string): void {
    this.setState(sha256, "uploaded");
  }

  /** Stops tracking an image (its file is gone from this phone). */
  forget(sha256: string): void {
    this.db.runSync("DELETE FROM files WHERE sha256 = ?", sha256);
  }

  /** Counts a failed upload or download; a file failing repeatedly waits for the next run. */
  markFailed(sha256: string, error: string): void {
    this.db.runSync(
      "UPDATE files SET attempts = attempts + 1, last_error = ?, updated_at = ? WHERE sha256 = ?",
      error.slice(0, 500),
      this.now(),
      sha256,
    );
  }

  private setState(sha256: string, state: SyncedFile["state"]): void {
    this.db.runSync(
      "UPDATE files SET state = ?, attempts = 0, last_error = NULL, updated_at = ? WHERE sha256 = ?",
      state,
      this.now(),
      sha256,
    );
  }

  private now(): string {
    return this.context.clock().toISOString();
  }
}
