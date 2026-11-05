import type { SQLiteDatabase } from "expo-sqlite";

import type { SyncIssue } from "../types.ts";
import type { StoreContext } from "./shared.ts";

/** Where a new phone is in downloading the shop (sync contract SnapshotResponse). */
export type SnapshotProgress = {
  /** Entities still to download, in order; the first is in progress. */
  remaining: SnapshotEntity[];
  /** `after` of the entity in progress. */
  after: string | null;
  /** The first page's `snapshot_seq`: pull continues from it. */
  seq: string | null;
};

export type SnapshotEntity =
  | "products"
  | "stock_levels"
  | "sales"
  | "reversals"
  | "embeddings";

/** Products first: everything else refers to them. */
export const SNAPSHOT_ORDER: readonly SnapshotEntity[] = [
  "products",
  "stock_levels",
  "sales",
  "reversals",
  "embeddings",
];

// Tables a phone that did not claim the shop's data clears before downloading the shop.
const BUSINESS_TABLES = [
  "cart_items",
  "sale_reversal_items",
  "sale_reversals",
  "sale_items",
  "sales",
  "stock_movements",
  "product_embeddings",
  "product_variants",
  "products",
  "outbox",
  "acked_ops",
  "files",
  "sync_issues",
  "sync_parked",
];

/**
 * A shop file's sync bookkeeping (`sync_state`, `sync_issues`). A file is `unbound` until the
 * phone ties it to its shop on the server; from then on every change is queued (outbox).
 */
export class SyncStateRepository {
  private db: SQLiteDatabase;
  private context: StoreContext;

  constructor(db: SQLiteDatabase, context: StoreContext) {
    this.db = db;
    this.context = context;
  }

  private read(key: string): string | null {
    return (
      this.db.getFirstSync<{ value: string }>(
        "SELECT value FROM sync_state WHERE key = ?",
        key,
      )?.value ?? null
    );
  }

  private write(key: string, value: string | null): void {
    if (value === null)
      this.db.runSync("DELETE FROM sync_state WHERE key = ?", key);
    else
      this.db.runSync(
        "INSERT INTO sync_state (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        key,
        value,
      );
  }

  isBound(): boolean {
    return this.read("mode") === "bound";
  }

  /** The shop this file is tied to (null while unbound). */
  shopId(): string | null {
    return this.read("shop_id");
  }

  /**
   * Ties the file to its shop. Call in the transaction that queues what the server must get
   * first (see sync/bind.ts). `snapshot` starts a download of the shop.
   */
  bind(shopId: string, { snapshot }: { snapshot: boolean }): void {
    this.write("mode", "bound");
    this.write("shop_id", shopId);
    this.write("cursor", "0");
    this.setSnapshot(
      snapshot ? { remaining: [...SNAPSHOT_ORDER], after: null, seq: null } : null,
    );
  }

  /** Empties a file of everything from before it was bound (it then downloads the shop). */
  resetForSnapshot(): void {
    for (const table of BUSINESS_TABLES) this.db.runSync(`DELETE FROM ${table}`);
  }

  cursor(): string {
    return this.read("cursor") ?? "0";
  }

  setCursor(cursor: string): void {
    this.write("cursor", cursor);
  }

  snapshot(): SnapshotProgress | null {
    const raw = this.read("snapshot");
    return raw ? (JSON.parse(raw) as SnapshotProgress) : null;
  }

  setSnapshot(progress: SnapshotProgress | null): void {
    this.write("snapshot", progress && JSON.stringify(progress));
  }

  /** Starts the download of the shop over (the server pruned this phone's history). */
  restartSnapshot(): void {
    this.setSnapshot({ remaining: [...SNAPSHOT_ORDER], after: null, seq: null });
  }

  lastSyncedAt(): string | null {
    return this.read("last_synced_at");
  }

  markSynced(): void {
    this.write("last_synced_at", this.context.clock().toISOString());
  }

  issues(): SyncIssue[] {
    return this.db.getAllSync<SyncIssue>(
      "SELECT * FROM sync_issues ORDER BY created_at DESC, id",
    );
  }

  addIssue(issue: Omit<SyncIssue, "id" | "created_at">): void {
    this.db.runSync(
      "INSERT INTO sync_issues (id, kind, entity, entity_id, op_id, code, message, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
      this.context.newId(),
      issue.kind,
      issue.entity,
      issue.entity_id,
      issue.op_id,
      issue.code,
      issue.message,
      this.context.clock().toISOString(),
    );
  }

  /** The oldest issues, to report to the server (which keeps them for the system admin). */
  unreported(limit: number): SyncIssue[] {
    return this.db.getAllSync<SyncIssue>(
      "SELECT * FROM sync_issues ORDER BY created_at, id LIMIT ?",
      limit,
    );
  }

  /** The server has these now: this phone keeps none of them. */
  forgetIssues(ids: readonly string[]): void {
    if (!ids.length) return;
    this.db.runSync(
      `DELETE FROM sync_issues WHERE id IN (${ids.map(() => "?").join(", ")})`,
      ...ids,
    );
  }
}
