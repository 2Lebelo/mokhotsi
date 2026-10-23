import type { Migration } from "./types.ts";

// Cost prices for profit, snapshotted onto receipts like the selling price, and
// sale reversals. A reversal never edits the sale it refunds: it is a separate
// record of which lines and quantities came back and whether they were restocked.
// Older sizes and receipts have no cost and stay NULL ("cost not set").
export const costAndReversals: Migration = {
  version: 6,
  name: "cost-and-reversals",
  up: (db) =>
    db.execSync(`
      ALTER TABLE product_variants ADD COLUMN cost_cents INTEGER
        CHECK(cost_cents IS NULL OR (cost_cents >= 0 AND cost_cents <= 9007199254740991));
      ALTER TABLE sale_items ADD COLUMN unit_cost_cents INTEGER
        CHECK(unit_cost_cents IS NULL OR (unit_cost_cents >= 0 AND unit_cost_cents <= 9007199254740991));

      CREATE TABLE sale_reversals (
        id TEXT PRIMARY KEY NOT NULL,
        sale_id TEXT NOT NULL REFERENCES sales(id),
        reason TEXT NOT NULL CHECK(length(trim(reason)) > 0),
        refund_cents INTEGER NOT NULL CHECK(refund_cents >= 0 AND refund_cents <= 9007199254740991),
        created_at TEXT NOT NULL
      );
      CREATE TABLE sale_reversal_items (
        id TEXT PRIMARY KEY NOT NULL,
        reversal_id TEXT NOT NULL REFERENCES sale_reversals(id),
        sale_item_id TEXT NOT NULL REFERENCES sale_items(id),
        quantity INTEGER NOT NULL CHECK(quantity > 0),
        restocked INTEGER NOT NULL CHECK(restocked IN (0, 1)),
        refund_cents INTEGER NOT NULL CHECK(refund_cents >= 0)
      );
      CREATE INDEX sale_reversals_sale ON sale_reversals(sale_id);
      CREATE INDEX sale_reversals_date ON sale_reversals(created_at);
      CREATE INDEX sale_reversal_items_reversal ON sale_reversal_items(reversal_id);
      CREATE INDEX sale_reversal_items_line ON sale_reversal_items(sale_item_id);
      CREATE INDEX sale_items_variant ON sale_items(variant_id);
    `),
};
