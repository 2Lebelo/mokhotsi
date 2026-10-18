import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

import { migrateDatabase } from "../src/db/schema.ts";
import { ShopStore } from "../src/db/store.ts";
import { parsePrice, parseStock } from "../src/lib/money.ts";

// Exercise the production SQL and repository against a real SQLite file.
// This adapter provides the small synchronous expo-sqlite API surface used by it.
function connect(filename) {
  const native = new DatabaseSync(filename);
  return {
    close: () => native.close(),
    execSync: (sql) => native.exec(sql),
    getFirstSync: (sql, ...params) =>
      native.prepare(sql).get(...params) ?? null,
    getAllSync: (sql, ...params) => native.prepare(sql).all(...params),
    runSync: (sql, ...params) => native.prepare(sql).run(...params),
    withTransactionSync(callback) {
      native.exec("BEGIN");
      try {
        callback();
        native.exec("COMMIT");
      } catch (error) {
        native.exec("ROLLBACK");
        throw error;
      }
    },
  };
}

function fixture(t) {
  const folder = mkdtempSync(join(tmpdir(), "mokhotsi-test-"));
  const filename = join(folder, "shop.db");
  let db = connect(filename);
  migrateDatabase(db);
  t.after(() => {
    db.close();
    assert.equal(dirname(resolve(folder)), resolve(tmpdir()));
    rmSync(folder, { recursive: true, force: true });
  });
  return {
    get db() {
      return db;
    },
    get store() {
      return new ShopStore(db, randomUUID);
    },
    reopen() {
      db.close();
      db = connect(filename);
      migrateDatabase(db);
    },
  };
}

const product = (changes = {}) => ({
  name: "Maize meal 2.5 kg",
  category: "Groceries",
  price_cents: 3250,
  stock: 12,
  barcode: null,
  photo_uri: null,
  ...changes,
});

test("product fields and cart survive closing and reopening the database; migrations preserve data", (t) => {
  const f = fixture(t);
  const input = product({
    barcode: "6001234567890",
    photo_uri: "file:///documents/product-photos/test.jpg",
  });
  const id = f.store.saveProduct(input);
  f.store.setQuantity(id, 3);
  const before = f.store.product(id);
  f.reopen();
  assert.deepEqual(f.store.product(id), before);
  assert.equal(f.store.cart()[0].quantity, 3);
  assert.equal(f.db.getFirstSync("PRAGMA user_version").user_version, 1);
  assert.equal(f.db.getFirstSync("PRAGMA foreign_keys").foreign_keys, 1);
});

test("checkout commits a receipt, reduces stock, and empties the persistent cart", (t) => {
  const f = fixture(t);
  const id = f.store.saveProduct(product());
  f.store.setQuantity(id, 2);
  const saleId = randomUUID();
  f.store.checkout(saleId);
  f.reopen();
  assert.equal(f.store.product(id).stock, 10);
  assert.equal(f.store.cart().length, 0);
  assert.equal(f.store.sales()[0].total_cents, 6500);
  assert.equal(f.store.saleItems(saleId)[0].quantity, 2);
  assert.equal(f.store.dashboard().today_sales, 1);
  assert.equal(f.store.dashboard().today_total, 6500);
});

test("repeating a checkout reference never duplicates a sale or consumes a new cart", (t) => {
  const f = fixture(t);
  const id = f.store.saveProduct(product());
  f.store.addToCart(id);
  const saleId = randomUUID();
  f.store.checkout(saleId);
  f.store.addToCart(id);
  f.store.checkout(saleId);
  assert.equal(f.store.sales().length, 1);
  assert.equal(f.store.product(id).stock, 11);
  assert.equal(f.store.cart()[0].quantity, 1);
});

test("a write failure halfway through checkout rolls back sale, receipt, and stock together", (t) => {
  const f = fixture(t);
  const id = f.store.saveProduct(product());
  f.store.setQuantity(id, 2);
  f.db.execSync(
    "CREATE TRIGGER fail_receipt BEFORE INSERT ON sale_items BEGIN SELECT RAISE(ABORT, 'simulated storage failure'); END;",
  );
  assert.throws(
    () => f.store.checkout(randomUUID()),
    /simulated storage failure/,
  );
  assert.equal(f.store.sales().length, 0);
  assert.equal(f.store.product(id).stock, 12);
  assert.equal(f.store.cart()[0].quantity, 2);
});

test("a stock edit below cart quantity blocks checkout, while quantities can be reduced", (t) => {
  const f = fixture(t);
  const id = f.store.saveProduct(product());
  f.store.setQuantity(id, 4);
  f.store.saveProduct(product({ stock: 1 }), id);
  assert.throws(() => f.store.checkout(randomUUID()), /Not enough stock/);
  assert.equal(f.store.sales().length, 0);
  f.store.setQuantity(id, 3);
  assert.equal(f.store.cart()[0].quantity, 3);
  f.store.setQuantity(id, 1);
  f.store.checkout(randomUUID());
  assert.equal(f.store.product(id).stock, 0);
});

test("insufficient stock, duplicate barcodes, invalid inputs, and empty sales are rejected", (t) => {
  const f = fixture(t);
  const id = f.store.saveProduct(product({ stock: 1, barcode: "123" }));
  assert.throws(() => f.store.setQuantity(id, 2), /Only 1/);
  assert.throws(
    () => f.store.saveProduct(product({ barcode: "123" })),
    /barcode already/,
  );
  assert.throws(() => f.store.saveProduct(product({ stock: -1 })), /Stock/);
  assert.throws(
    () => f.store.saveProduct(product({ price_cents: 1.2 })),
    /Price/,
  );
  assert.throws(
    () => f.store.saveProduct(product({ category: " " })),
    /category/,
  );
  assert.throws(() => f.store.checkout(randomUUID()), /at least one/);
  assert.equal(f.store.products().length, 1);
});

test("product edits never change an earlier receipt", (t) => {
  const f = fixture(t);
  const id = f.store.saveProduct(product());
  f.store.addToCart(id);
  const saleId = randomUUID();
  f.store.checkout(saleId);
  f.store.saveProduct(
    product({
      name: "Renamed",
      category: "New category",
      price_cents: 5000,
      stock: 11,
    }),
    id,
  );
  const receipt = f.store.saleItems(saleId)[0];
  assert.equal(receipt.product_name, "Maize meal 2.5 kg");
  assert.equal(receipt.category, "Groceries");
  assert.equal(receipt.unit_price_cents, 3250);
  assert.equal(f.store.sales()[0].total_cents, 3250);
});

test("total overflow is rejected and its cart mutation is rolled back", (t) => {
  const f = fixture(t);
  const id = f.store.saveProduct(
    product({ price_cents: Number.MAX_SAFE_INTEGER }),
  );
  f.store.addToCart(id);
  assert.throws(() => f.store.setQuantity(id, 2), /too large/);
  assert.equal(f.store.cart()[0].quantity, 1);
});

test("SQL-looking names are stored as data", (t) => {
  const f = fixture(t);
  const name = "O'Brien'); DROP TABLE products; --";
  const id = f.store.saveProduct(product({ name }));
  assert.equal(f.store.product(id).name, name);
  assert.equal(f.store.products().length, 1);
});

test("future database versions are rejected without deleting records", (t) => {
  const f = fixture(t);
  f.store.saveProduct(product());
  f.db.execSync("PRAGMA user_version = 999");
  assert.throws(() => migrateDatabase(f.db), /newer Mokhotsi/);
  assert.equal(f.store.products().length, 1);
});

test("price parsing preserves cents and rejects malformed amounts", () => {
  assert.equal(parsePrice("0.29"), 29);
  assert.equal(parsePrice("32,50"), 3250);
  assert.equal(parsePrice(" 001.2 "), 120);
  for (const value of ["", "-1", "1.001", "NaN", "1e3", "999999999999999999"])
    assert.throws(() => parsePrice(value));
  assert.equal(parseStock("0"), 0);
  for (const value of ["-1", "1.5", ""]) assert.throws(() => parseStock(value));
});
