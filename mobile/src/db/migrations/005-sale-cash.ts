import type { Migration } from "./types.ts";

// The cash a customer handed over and the change given back, for the receipt.
// Sales recorded before this step have neither.
export const saleCash: Migration = {
  version: 5,
  name: "sale-cash",
  up: (db) =>
    db.execSync(`
      ALTER TABLE sales ADD COLUMN tendered_cents INTEGER
        CHECK(tendered_cents IS NULL OR (tendered_cents >= 0 AND tendered_cents <= 9007199254740991));
      ALTER TABLE sales ADD COLUMN change_cents INTEGER
        CHECK(change_cents IS NULL OR (change_cents >= 0 AND change_cents <= 9007199254740991));
    `),
};
