import type { SQLiteDatabase } from "expo-sqlite";

import { CartRepository } from "./repositories/cart.ts";
import { CatalogueRepository } from "./repositories/catalogue.ts";
import { EmbeddingsRepository } from "./repositories/embeddings.ts";
import { ReportsRepository } from "./repositories/reports.ts";
import { SalesRepository } from "./repositories/sales.ts";
import type { IdFactory } from "./repositories/shared.ts";

export { cartTotal } from "./repositories/cart.ts";
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

  constructor(db: SQLiteDatabase, newId: IdFactory, revision = 0) {
    this.revision = revision;
    this.catalogue = new CatalogueRepository(db, newId);
    this.cart = new CartRepository(db);
    this.sales = new SalesRepository(db, newId, this.cart);
    this.reports = new ReportsRepository(db);
    this.embeddings = new EmbeddingsRepository(db, newId);
  }
}
