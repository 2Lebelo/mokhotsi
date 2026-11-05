import type { SQLiteDatabase } from "expo-sqlite";

import type {
  EmbeddingPayload,
  ProductPayload,
  PulledRecord,
  ReversalPayload,
  SalePayload,
} from "../../contracts/sync.ts";
import { decodeF16 } from "../../ml/float16.ts";
import { toBlob } from "../../ml/vector.ts";
import type { OutboxRepository } from "./outbox.ts";
import type { StoreContext } from "./shared.ts";
import type { StockLedger } from "./stock.ts";
import type { SyncStateRepository } from "./sync-state.ts";
import type { SyncedFilesRepository } from "./synced-files.ts";

export type ApplyOptions = {
  /** The embedder this phone runs; views of other models are not stored. */
  modelVersion: string;
  /** Where an image another phone synced will be stored here, by content hash. */
  imageUri: (sha256: string) => string;
};

/** What a page changed, so screens and the vision index refresh only when they must. */
export type Applied = { catalogue: boolean; sales: boolean; embeddings: boolean };

/** Things a record refers to come first, so a page applies whatever order it arrives in. */
const RANK: Record<PulledRecord["entity"], number> = {
  products: 0,
  stock_levels: 1,
  sales: 2,
  reversals: 3,
  embeddings: 4,
};

/** How long a record may wait for what it refers to before the admin hears of it. */
export const PARKED_ESCALATE_MS = 24 * 60 * 60_000;

/**
 * Writes what other phones changed (pull and snapshot pages) into this shop's file.
 *
 * - A page is applied in one transaction with the cursor that follows it (`commit`), so an
 *   interrupted sync never skips or half-applies a page.
 * - Records are applied products first. One that refers to something this phone does not
 *   have yet (a sale whose product comes in a later page) is parked in `sync_parked` and
 *   applied as soon as that arrives: the server sends each record at its latest change and a
 *   new phone downloads each kind separately, so this order is normal, not an error.
 * - Each record has its own savepoint: one that clashes with this phone's data (a barcode
 *   or size taken by another product) is left out and reported, and the rest still applies.
 * - A record this phone still has a change queued for is skipped: the local change wins
 *   until the server has it, and the next pull brings the merged state back.
 * - Nothing here is queued for the server, and stock only changes through `server_stock`
 *   (see StockLedger.rebase): sales from other tills never move stock twice.
 */
export class RemoteApply {
  private db: SQLiteDatabase;
  private context: StoreContext;
  private outbox: OutboxRepository;
  private stock: StockLedger;
  private files: SyncedFilesRepository;
  private state: SyncStateRepository;

  constructor(
    db: SQLiteDatabase,
    context: StoreContext,
    deps: {
      outbox: OutboxRepository;
      stock: StockLedger;
      files: SyncedFilesRepository;
      state: SyncStateRepository;
    },
  ) {
    this.db = db;
    this.context = context;
    this.outbox = deps.outbox;
    this.stock = deps.stock;
    this.files = deps.files;
    this.state = deps.state;
  }

  applyPage(
    records: readonly PulledRecord[],
    options: ApplyOptions,
    commit: () => void,
  ): Applied {
    const applied: Applied = { catalogue: false, sales: false, embeddings: false };
    // Array.prototype.sort is stable: records of one kind keep the server's order.
    const ordered = [...records].sort((a, b) => RANK[a.entity] - RANK[b.entity]);
    this.db.withTransactionSync(() => {
      ordered.forEach((change) => this.attempt(change, options, applied));
      this.retryParked(options, applied);
      commit();
    });
    return applied;
  }

  /**
   * Records parked longer than PARKED_ESCALATE_MS become one issue each (they keep waiting).
   * Call when the phone is up to date with the server, so a record is only reported when
   * what it refers to really is not coming.
   */
  escalateStale(): void {
    const cutoff = new Date(this.context.clock().getTime() - PARKED_ESCALATE_MS).toISOString();
    const stale = this.db.getAllSync<{ entity: string; record_id: string; reason: string }>(
      "SELECT entity, record_id, reason FROM sync_parked WHERE escalated = 0 AND first_seen_at <= ?",
      cutoff,
    );
    if (!stale.length) return;
    this.db.withTransactionSync(() => {
      for (const row of stale) {
        this.state.addIssue({
          kind: "conflict",
          entity: row.entity,
          entity_id: row.record_id,
          op_id: null,
          code: "missing_reference",
          message: row.reason,
        });
        this.db.runSync(
          "UPDATE sync_parked SET escalated = 1 WHERE entity = ? AND record_id = ?",
          row.entity,
          row.record_id,
        );
      }
    });
  }

  parkedCount(): number {
    return this.db.getFirstSync<{ n: number }>("SELECT COUNT(*) AS n FROM sync_parked")?.n ?? 0;
  }

  /** Applies one record, parks it, or reports it. True once it is applied (or ignored). */
  private attempt(change: PulledRecord, options: ApplyOptions, applied: Applied): boolean {
    const id = recordId(change);
    const missing = this.missing(change, options);
    if (missing) {
      this.park(change, missing);
      return false;
    }
    this.db.execSync("SAVEPOINT pulled");
    try {
      this.apply(change, options, applied);
      this.db.execSync("RELEASE pulled");
    } catch (cause) {
      this.db.execSync("ROLLBACK TO pulled");
      this.db.execSync("RELEASE pulled");
      this.state.addIssue({
        kind: "conflict",
        entity: change.entity,
        entity_id: id,
        op_id: null,
        code: "conflict",
        message: cause instanceof Error ? cause.message : String(cause),
      });
    }
    this.db.runSync(
      "DELETE FROM sync_parked WHERE entity = ? AND record_id = ?",
      change.entity,
      id,
    );
    return true;
  }

  /** Parked records whose references arrived, in dependency order, until none move. */
  private retryParked(options: ApplyOptions, applied: Applied): void {
    for (;;) {
      const parked = this.db
        .getAllSync<{ entity: PulledRecord["entity"]; record: string }>(
          "SELECT entity, record FROM sync_parked",
        )
        .map((row) => ({ entity: row.entity, record: JSON.parse(row.record) }) as PulledRecord)
        .sort((a, b) => RANK[a.entity] - RANK[b.entity]);
      let progressed = false;
      for (const change of parked) {
        if (this.missing(change, options)) continue; // Still waiting: left as it is.
        this.attempt(change, options, applied);
        progressed = true;
      }
      if (!progressed) return;
    }
  }

  private park(change: PulledRecord, reason: string): void {
    this.db.runSync(
      `INSERT INTO sync_parked (entity, record_id, record, reason, first_seen_at) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT (entity, record_id) DO UPDATE SET record = excluded.record, reason = excluded.reason`,
      change.entity,
      recordId(change),
      JSON.stringify(change.record),
      reason,
      this.context.clock().toISOString(),
    );
  }

  /** What `change` refers to that this phone does not have yet, in words; null if nothing. */
  private missing(change: PulledRecord, options: ApplyOptions): string | null {
    switch (change.entity) {
      case "products":
        return null;
      case "stock_levels":
        return this.has("product_variants", [change.record.variant_id])
          ? null
          : "Waiting for the size it counts";
      case "sales": {
        const { items } = change.record;
        if (this.has("sales", [change.record.id])) return null; // Already here.
        return this.has("products", items.map((item) => item.product_id)) &&
          this.has("product_variants", items.map((item) => item.variant_id))
          ? null
          : "Waiting for a product it sold";
      }
      case "reversals":
        if (this.has("sale_reversals", [change.record.id])) return null;
        return this.has("sales", [change.record.sale_id]) &&
          this.has("sale_items", change.record.items.map((item) => item.sale_item_id))
          ? null
          : "Waiting for the sale it reverses";
      case "embeddings":
        if ("deleted" in change.record) return null;
        if (change.record.model_version !== options.modelVersion) return null; // Not kept.
        return this.has("products", [change.record.product_id])
          ? null
          : "Waiting for the product it shows";
    }
  }

  /** Whether every id is in `table` (ids may repeat). */
  private has(table: string, ids: readonly string[]): boolean {
    const unique = [...new Set(ids)];
    if (!unique.length) return true;
    const found = this.db.getFirstSync<{ n: number }>(
      `SELECT COUNT(*) AS n FROM ${table} WHERE id IN (${unique.map(() => "?").join(", ")})`,
      ...unique,
    );
    return found?.n === unique.length;
  }

  private apply(change: PulledRecord, options: ApplyOptions, applied: Applied): void {
    switch (change.entity) {
      case "products":
        if (this.product(change.record, options)) applied.catalogue = true;
        return;
      case "sales":
        if (this.sale(change.record)) applied.sales = true;
        return;
      case "reversals":
        if (this.reversal(change.record)) applied.sales = true;
        return;
      case "stock_levels":
        this.stock.setServerStock(change.record.variant_id, change.record.stock);
        applied.catalogue = true;
        return;
      case "embeddings":
        if ("deleted" in change.record) {
          this.db.runSync("DELETE FROM product_embeddings WHERE id = ?", change.record.id);
          applied.embeddings = true;
        } else if (this.embedding(change.record, options)) applied.embeddings = true;
        return;
    }
  }

  private product(p: ProductPayload, options: ApplyOptions): boolean {
    if (this.outbox.hasPending("products", p.id)) return false;
    const now = this.context.clock().toISOString();
    const local = this.db.getFirstSync<{
      photo_uri: string | null;
      photo2_uri: string | null;
      photo_hash: string | null;
      photo2_hash: string | null;
    }>("SELECT photo_uri, photo2_uri, photo_hash, photo2_hash FROM products WHERE id = ?", p.id);
    const photo = (slot: 0 | 1): [string | null, string | null] => {
      const sha = p.photos.find((each) => each.slot === slot)?.sha256 ?? null;
      if (!sha) return [null, null];
      // Keep this phone's own file for an unchanged photo; otherwise expect a download.
      if (local?.photo_hash === sha && local.photo_uri) return [local.photo_uri, sha];
      if (local?.photo2_hash === sha && local.photo2_uri) return [local.photo2_uri, sha];
      return [this.files.expect(sha, "photo", options.imageUri(sha)), sha];
    };
    const [photoUri, photoHash] = photo(0);
    const [photo2Uri, photo2Hash] = photo(1);
    this.db.runSync(
      `INSERT INTO products (id, name, category, photo_uri, photo2_uri, photo_hash, photo2_hash, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET name = excluded.name, category = excluded.category,
         photo_uri = excluded.photo_uri, photo2_uri = excluded.photo2_uri,
         photo_hash = excluded.photo_hash, photo2_hash = excluded.photo2_hash,
         updated_at = excluded.updated_at`,
      p.id,
      p.name,
      p.category,
      photoUri,
      photo2Uri,
      photoHash,
      photo2Hash,
      p.created_at,
      p.updated_at,
    );
    // As in saveProduct: deactivate every size first, so sizes or barcodes swapped between
    // rows never trip a unique index midway; the payload then sets each size's own state.
    this.db.runSync(
      "UPDATE product_variants SET archived_at = ? WHERE product_id = ? AND archived_at IS NULL",
      now,
      p.id,
    );
    for (const v of p.variants)
      this.db.runSync(
        `INSERT INTO product_variants (id, product_id, size_milli, unit, price_cents, cost_cents, stock, server_stock, barcode, position, archived_at, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, 0, 0, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET size_milli = excluded.size_milli, unit = excluded.unit,
           price_cents = excluded.price_cents, cost_cents = excluded.cost_cents,
           barcode = excluded.barcode, position = excluded.position,
           archived_at = excluded.archived_at, updated_at = excluded.updated_at`,
        v.id,
        p.id,
        v.size_milli,
        v.unit,
        v.price_cents,
        v.cost_cents,
        v.barcode,
        v.position,
        v.archived_at,
        p.updated_at,
        p.updated_at,
      );
    // A size this phone sells from its cart may have just been withdrawn.
    this.db.runSync(
      "DELETE FROM cart_items WHERE variant_id IN (SELECT id FROM product_variants WHERE product_id = ? AND archived_at IS NOT NULL)",
      p.id,
    );
    return true;
  }

  private sale(s: SalePayload): boolean {
    const inserted = this.db.runSync(
      "INSERT OR IGNORE INTO sales (id, total_cents, tendered_cents, change_cents, actor_user_id, device_id, imported, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
      s.id,
      s.total_cents,
      s.tendered_cents,
      s.change_cents,
      s.actor_user_id,
      s.device_id,
      s.imported ? 1 : 0,
      s.created_at,
    );
    if (!inserted.changes) return false;
    for (const item of s.items)
      this.db.runSync(
        "INSERT OR IGNORE INTO sale_items (id, sale_id, product_id, variant_id, product_name, variant_label, category, barcode, quantity, unit_price_cents, line_total_cents, unit_cost_cents) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        item.id,
        s.id,
        item.product_id,
        item.variant_id,
        item.product_name,
        item.variant_label,
        item.category,
        item.barcode,
        item.quantity,
        item.unit_price_cents,
        item.line_total_cents,
        item.unit_cost_cents,
      );
    return true;
  }

  private reversal(r: ReversalPayload): boolean {
    const inserted = this.db.runSync(
      "INSERT OR IGNORE INTO sale_reversals (id, sale_id, reason, refund_cents, actor_user_id, device_id, imported, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
      r.id,
      r.sale_id,
      r.reason,
      r.refund_cents,
      r.actor_user_id,
      r.device_id,
      r.imported ? 1 : 0,
      r.created_at,
    );
    if (!inserted.changes) return false;
    for (const item of r.items)
      this.db.runSync(
        "INSERT OR IGNORE INTO sale_reversal_items (id, reversal_id, sale_item_id, quantity, restocked, refund_cents) VALUES (?, ?, ?, ?, ?, ?)",
        item.id,
        r.id,
        item.sale_item_id,
        item.quantity,
        item.restocked ? 1 : 0,
        item.refund_cents,
      );
    return true;
  }

  private embedding(e: EmbeddingPayload, options: ApplyOptions): boolean {
    if (e.model_version !== options.modelVersion) return false;
    let imageUri: string | null = null;
    if (e.image_sha256) {
      // A product photo view points at that photo, which reconcile compares by URI.
      const photo = this.db.getFirstSync<{ uri: string }>(
        `SELECT CASE WHEN photo_hash = ? THEN photo_uri ELSE photo2_uri END AS uri
         FROM products WHERE id = ? AND (photo_hash = ? OR photo2_hash = ?)`,
        e.image_sha256,
        e.product_id,
        e.image_sha256,
        e.image_sha256,
      );
      imageUri =
        e.source === "photo" && photo
          ? photo.uri
          : this.files.expect(e.image_sha256, "crop", options.imageUri(e.image_sha256));
    }
    const inserted = this.db.runSync(
      "INSERT OR IGNORE INTO product_embeddings (id, product_id, model_version, vector, source, image_uri, image_sha256, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
      e.id,
      e.product_id,
      e.model_version,
      toBlob(decodeF16(e.vector_f16, e.dim)),
      e.source,
      imageUri,
      e.image_sha256,
      e.created_at,
    );
    return inserted.changes > 0;
  }
}

function recordId(change: PulledRecord): string {
  return change.entity === "stock_levels" ? change.record.variant_id : change.record.id;
}
