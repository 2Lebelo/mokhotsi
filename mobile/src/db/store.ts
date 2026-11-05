import type { SQLiteDatabase } from "expo-sqlite";

import { CartRepository } from "./repositories/cart.ts";
import { CatalogueRepository } from "./repositories/catalogue.ts";
import { EmbeddingsRepository } from "./repositories/embeddings.ts";
import { OutboxRepository } from "./repositories/outbox.ts";
import { RemoteApply } from "./repositories/remote.ts";
import { ReportsRepository } from "./repositories/reports.ts";
import { SalesRepository } from "./repositories/sales.ts";
import type { StoreContext } from "./repositories/shared.ts";
import { StockLedger } from "./repositories/stock.ts";
import { SyncStateRepository } from "./repositories/sync-state.ts";
import { SyncedFilesRepository } from "./repositories/synced-files.ts";

export { cartTotal } from "./repositories/cart.ts";
export {
  LOCAL_ACTOR,
  type Actor,
  type StoreContext,
} from "./repositories/shared.ts";
export type * from "./types.ts";

/**
 * The single entry point screens use for local data. A new facade is created per
 * revision so React Compiler's memoized reads are recomputed after every write.
 */
export class ShopStore {
  readonly revision: number;
  readonly catalogue: CatalogueRepository;
  readonly cart: CartRepository;
  readonly sales: SalesRepository;
  readonly reports: ReportsRepository;
  readonly embeddings: EmbeddingsRepository;
  readonly outbox: OutboxRepository;
  readonly stock: StockLedger;
  /** Sync bookkeeping, synced images, and applying what other phones changed. */
  readonly sync: SyncStateRepository;
  readonly files: SyncedFilesRepository;
  readonly remote: RemoteApply;
  /**
   * The same object for every revision of one shop's database and a different one per shop:
   * a cache key for data derived from it (the vision index).
   */
  readonly identity: object;
  private db: SQLiteDatabase;

  constructor(db: SQLiteDatabase, context: StoreContext, revision = 0) {
    this.db = db;
    this.identity = db;
    this.revision = revision;
    this.outbox = new OutboxRepository(db, context);
    this.stock = new StockLedger(db, context, this.outbox);
    this.catalogue = new CatalogueRepository(db, context, this.outbox, this.stock);
    this.cart = new CartRepository(db);
    this.sales = new SalesRepository(
      db,
      context,
      this.cart,
      this.outbox,
      this.stock,
    );
    this.reports = new ReportsRepository(db);
    this.embeddings = new EmbeddingsRepository(db, context, this.outbox);
    this.sync = new SyncStateRepository(db, context);
    this.files = new SyncedFilesRepository(db, context);
    this.remote = new RemoteApply(db, context, {
      outbox: this.outbox,
      stock: this.stock,
      files: this.files,
      state: this.sync,
    });
  }

  /** Runs `work` in one transaction (several repository writes that must commit together). */
  transaction(work: () => void): void {
    this.db.withTransactionSync(work);
  }

  /** Whether the shop holds anything worth keeping: products or sales. */
  hasData(): boolean {
    return (
      this.db.getFirstSync(
        "SELECT 1 FROM products UNION ALL SELECT 1 FROM sales LIMIT 1",
      ) !== null
    );
  }
}
