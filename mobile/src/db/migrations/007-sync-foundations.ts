import type { Migration } from "./types.ts";

// Local groundwork for syncing a shop to the server. Nothing is sent yet.
// - `outbox` queues each change in the same transaction as the change itself. It is only
//   written once the shop is bound to a server (`sync_state.mode`), so an unregistered
//   phone behaves exactly as before.
// - `stock_movements` is the stock ledger. `product_variants.stock` becomes this phone's
//   projection: the server's figure plus the movements it has not acknowledged yet. With
//   several tills the projection can drop below zero, so that CHECK is relaxed (the table is
//   rebuilt with SQLite's create, copy, drop, rename procedure).
// - Sales and reversals record who made them on which phone; earlier ones were "local".
export const syncFoundations: Migration = {
  version: 7,
  name: "sync-foundations",
  up: (db) =>
    db.execSync(`
      CREATE TABLE outbox (
        seq INTEGER PRIMARY KEY AUTOINCREMENT,
        op_id TEXT NOT NULL UNIQUE,
        entity TEXT NOT NULL CHECK(entity IN ('products', 'sales', 'reversals', 'stock_movements')),
        entity_id TEXT NOT NULL,
        op TEXT NOT NULL DEFAULT 'upsert' CHECK(op IN ('upsert', 'delete')),
        payload TEXT NOT NULL CHECK(json_valid(payload)),
        status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending', 'rejected')),
        reason TEXT,
        attempts INTEGER NOT NULL DEFAULT 0,
        last_error TEXT,
        created_at TEXT NOT NULL
      );
      CREATE INDEX outbox_status ON outbox(status, seq);
      CREATE UNIQUE INDEX outbox_coalesce ON outbox(entity, entity_id)
        WHERE status = 'pending' AND entity = 'products';

      CREATE TABLE sync_state (
        key TEXT PRIMARY KEY NOT NULL,
        value TEXT NOT NULL
      );
      INSERT INTO sync_state (key, value) VALUES ('mode', 'unbound');

      CREATE TABLE product_variants_v7 (
        id TEXT PRIMARY KEY NOT NULL,
        product_id TEXT NOT NULL REFERENCES products(id),
        size_milli INTEGER NOT NULL CHECK(size_milli > 0 AND size_milli <= 9007199254740991),
        unit TEXT NOT NULL CHECK(length(unit) > 0),
        price_cents INTEGER NOT NULL CHECK(price_cents >= 0 AND price_cents <= 9007199254740991),
        cost_cents INTEGER
          CHECK(cost_cents IS NULL OR (cost_cents >= 0 AND cost_cents <= 9007199254740991)),
        stock INTEGER NOT NULL CHECK(stock BETWEEN -9007199254740991 AND 9007199254740991),
        server_stock INTEGER NOT NULL DEFAULT 0
          CHECK(server_stock BETWEEN -9007199254740991 AND 9007199254740991),
        barcode TEXT,
        position INTEGER NOT NULL DEFAULT 0,
        archived_at TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      INSERT INTO product_variants_v7 (id, product_id, size_milli, unit, price_cents, cost_cents, stock, barcode, position, archived_at, created_at, updated_at)
        SELECT id, product_id, size_milli, unit, price_cents, cost_cents, stock, barcode, position, archived_at, created_at, updated_at FROM product_variants;
      DROP TABLE product_variants;
      ALTER TABLE product_variants_v7 RENAME TO product_variants;
      CREATE UNIQUE INDEX variants_barcode ON product_variants(barcode)
        WHERE barcode IS NOT NULL AND archived_at IS NULL;
      CREATE UNIQUE INDEX variants_size ON product_variants(product_id, unit, size_milli)
        WHERE archived_at IS NULL;
      CREATE INDEX variants_product ON product_variants(product_id, position);

      CREATE TABLE stock_movements (
        id TEXT PRIMARY KEY NOT NULL,
        variant_id TEXT NOT NULL REFERENCES product_variants(id),
        delta INTEGER NOT NULL
          CHECK(delta <> 0 AND delta BETWEEN -9007199254740991 AND 9007199254740991),
        kind TEXT NOT NULL CHECK(kind IN ('opening', 'restock', 'adjustment', 'sale', 'reversal')),
        ref_id TEXT,
        op_id TEXT,
        actor_user_id TEXT NOT NULL,
        device_id TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE INDEX stock_movements_variant ON stock_movements(variant_id, created_at);
      CREATE INDEX stock_movements_op ON stock_movements(op_id) WHERE op_id IS NOT NULL;

      ALTER TABLE sales ADD COLUMN actor_user_id TEXT NOT NULL DEFAULT 'local';
      ALTER TABLE sales ADD COLUMN device_id TEXT NOT NULL DEFAULT 'local';
      ALTER TABLE sale_reversals ADD COLUMN actor_user_id TEXT NOT NULL DEFAULT 'local';
      ALTER TABLE sale_reversals ADD COLUMN device_id TEXT NOT NULL DEFAULT 'local';
    `),
};
