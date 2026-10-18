import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

import { MIGRATIONS } from "../src/db/migrations/index.ts";
import { migrateDatabase, SCHEMA_VERSION } from "../src/db/schema.ts";
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

function fixture(t, { migrate = true } = {}) {
  const folder = mkdtempSync(join(tmpdir(), "mokhotsi-test-"));
  const filename = join(folder, "shop.db");
  let db = connect(filename);
  if (migrate) migrateDatabase(db);
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

const size = (changes = {}) => ({
  size_milli: 2500,
  unit: "kg",
  price_cents: 3250,
  stock: 12,
  barcode: null,
  ...changes,
});

const product = (changes = {}, variants = [size()]) => ({
  name: "Maize meal",
  category: "Groceries",
  photo_uri: null,
  variants,
  ...changes,
});

/** Saves a one-size product and returns its product and size ids. */
function saveOne(store, changes = {}, sizeChanges = {}) {
  const productId = store.catalogue.saveProduct(
    product(changes, [size(sizeChanges)]),
  );
  return {
    productId,
    variantId: store.catalogue.product(productId).variants[0].id,
  };
}

test("product sizes and the cart survive closing and reopening the database", (t) => {
  const f = fixture(t);
  const productId = f.store.catalogue.saveProduct(
    product({ photo_uri: "file:///documents/product-photos/test.jpg" }, [
      size({ barcode: "6001234567890" }),
      size({ size_milli: 1000, price_cents: 1500, stock: 4 }),
    ]),
  );
  const [large] = f.store.catalogue.product(productId).variants;
  f.store.cart.setQuantity(large.id, 3);
  const before = f.store.catalogue.product(productId);
  f.reopen();
  assert.deepEqual(f.store.catalogue.product(productId), before);
  assert.equal(before.variants.length, 2);
  assert.equal(f.store.cart.items()[0].quantity, 3);
  assert.equal(
    f.db.getFirstSync("PRAGMA user_version").user_version,
    SCHEMA_VERSION,
  );
  assert.equal(f.db.getFirstSync("PRAGMA foreign_keys").foreign_keys, 1);
});

test("each size keeps its own stock through checkout", (t) => {
  const f = fixture(t);
  const productId = f.store.catalogue.saveProduct(
    product({ name: "Sugar" }, [
      size({ size_milli: 500000, unit: "g", price_cents: 1500, stock: 10 }),
      size({ size_milli: 2000, unit: "kg", price_cents: 5000, stock: 3 }),
    ]),
  );
  const [small, large] = f.store.catalogue.product(productId).variants;
  f.store.cart.setQuantity(small.id, 4);
  f.store.cart.add(large.id);
  const saleId = randomUUID();
  f.store.sales.checkout(saleId);
  f.reopen();
  const [smallAfter, largeAfter] =
    f.store.catalogue.product(productId).variants;
  assert.equal(smallAfter.stock, 6);
  assert.equal(largeAfter.stock, 2);
  assert.equal(f.store.cart.items().length, 0);
  assert.equal(f.store.sales.list()[0].total_cents, 4 * 1500 + 5000);
  const receipt = f.store.sales.items(saleId);
  assert.deepEqual(
    receipt.map((line) => [line.variant_label, line.quantity]),
    [
      ["2 kg", 1],
      ["500 g", 4],
    ],
  );
  assert.equal(f.store.sales.dashboard().today_sales, 1);
  assert.equal(f.store.sales.dashboard().unit_count, 8);
});

test("repeating a checkout reference never duplicates a sale or consumes a new cart", (t) => {
  const f = fixture(t);
  const { variantId } = saveOne(f.store);
  f.store.cart.add(variantId);
  const saleId = randomUUID();
  f.store.sales.checkout(saleId);
  f.store.cart.add(variantId);
  f.store.sales.checkout(saleId);
  assert.equal(f.store.sales.list().length, 1);
  assert.equal(f.store.catalogue.variant(variantId).stock, 11);
  assert.equal(f.store.cart.items()[0].quantity, 1);
});

test("a write failure halfway through checkout rolls back sale, receipt, and stock together", (t) => {
  const f = fixture(t);
  const { variantId } = saveOne(f.store);
  f.store.cart.setQuantity(variantId, 2);
  f.db.execSync(
    "CREATE TRIGGER fail_receipt BEFORE INSERT ON sale_items BEGIN SELECT RAISE(ABORT, 'simulated storage failure'); END;",
  );
  assert.throws(
    () => f.store.sales.checkout(randomUUID()),
    /simulated storage failure/,
  );
  assert.equal(f.store.sales.list().length, 0);
  assert.equal(f.store.catalogue.variant(variantId).stock, 12);
  assert.equal(f.store.cart.items()[0].quantity, 2);
});

test("a stock edit below cart quantity blocks checkout, while quantities can be reduced", (t) => {
  const f = fixture(t);
  const { productId, variantId } = saveOne(f.store);
  f.store.cart.setQuantity(variantId, 4);
  f.store.catalogue.saveProduct(
    product({}, [size({ id: variantId, stock: 1 })]),
    productId,
  );
  assert.throws(() => f.store.sales.checkout(randomUUID()), /Not enough stock/);
  assert.equal(f.store.sales.list().length, 0);
  f.store.cart.setQuantity(variantId, 3);
  assert.equal(f.store.cart.items()[0].quantity, 3);
  f.store.cart.setQuantity(variantId, 1);
  f.store.sales.checkout(randomUUID());
  assert.equal(f.store.catalogue.variant(variantId).stock, 0);
  assert.throws(() => f.store.cart.add(variantId), /out of stock/);
});

test("insufficient stock, duplicate barcodes and sizes, invalid inputs, and empty sales are rejected", (t) => {
  const f = fixture(t);
  const { variantId } = saveOne(f.store, {}, { stock: 1, barcode: "123" });
  assert.throws(() => f.store.cart.setQuantity(variantId, 2), /Only 1/);
  assert.throws(
    () =>
      f.store.catalogue.saveProduct(product({}, [size({ barcode: "123" })])),
    /already belongs to Maize meal · 2\.5 kg/,
  );
  assert.throws(
    () =>
      f.store.catalogue.saveProduct(
        product({}, [
          size({ barcode: "9" }),
          size({ barcode: "9", size_milli: 1000 }),
        ]),
      ),
    /entered for two sizes/,
  );
  assert.throws(
    () => f.store.catalogue.saveProduct(product({}, [size(), size()])),
    /both 2\.5 kg/,
  );
  assert.throws(
    () => f.store.catalogue.saveProduct(product({}, [])),
    /at least one size/,
  );
  assert.throws(
    () => f.store.catalogue.saveProduct(product({}, [size({ stock: -1 })])),
    /Stock/,
  );
  assert.throws(
    () =>
      f.store.catalogue.saveProduct(product({}, [size({ price_cents: 1.2 })])),
    /Price/,
  );
  assert.throws(
    () =>
      f.store.catalogue.saveProduct(product({}, [size({ unit: "furlong" })])),
    /unit/,
  );
  assert.throws(
    () =>
      f.store.catalogue.saveProduct(
        product({}, [size({ unit: "pack", size_milli: 6500 })]),
      ),
    /whole number/,
  );
  assert.throws(
    () => f.store.catalogue.saveProduct(product({ category: " " })),
    /category/,
  );
  assert.throws(() => f.store.sales.checkout(randomUUID()), /at least one/);
  assert.equal(f.store.catalogue.products().length, 1);
});

test("removing a size archives it: receipts keep it, the cart drops it, and its barcode is free again", (t) => {
  const f = fixture(t);
  const productId = f.store.catalogue.saveProduct(
    product({ name: "Sugar" }, [
      size({ size_milli: 500000, unit: "g", barcode: "111" }),
      size({ size_milli: 2000, unit: "kg", barcode: "222" }),
    ]),
  );
  const [small, large] = f.store.catalogue.product(productId).variants;
  f.store.cart.add(small.id);
  const saleId = randomUUID();
  f.store.sales.checkout(saleId);
  f.store.cart.add(small.id);
  f.store.cart.add(large.id);

  f.store.catalogue.saveProduct(
    product({ name: "Sugar" }, [
      size({ id: large.id, size_milli: 2000, unit: "kg", barcode: "222" }),
    ]),
    productId,
  );

  assert.deepEqual(
    f.store.catalogue.product(productId).variants.map((v) => v.id),
    [large.id],
  );
  assert.deepEqual(
    f.store.cart.items().map((item) => item.id),
    [large.id],
  );
  assert.equal(f.store.sales.items(saleId)[0].variant_label, "500 g");
  assert.equal(f.store.catalogue.variantByBarcode("111"), null);
  assert.throws(() => f.store.cart.add(small.id), /no longer sold/);
  const other = saveOne(f.store, { name: "Other" }, { barcode: "111" });
  assert.equal(f.store.catalogue.variantByBarcode("111").id, other.variantId);
});

test("sizes can swap barcodes and amounts in one save", (t) => {
  const f = fixture(t);
  const productId = f.store.catalogue.saveProduct(
    product({}, [
      size({ size_milli: 1000, barcode: "A" }),
      size({ size_milli: 2000, barcode: "B" }),
    ]),
  );
  const [one, two] = f.store.catalogue.product(productId).variants;
  f.store.catalogue.saveProduct(
    product({}, [
      size({ id: one.id, size_milli: 2000, barcode: "B" }),
      size({ id: two.id, size_milli: 1000, barcode: "A" }),
    ]),
    productId,
  );
  const after = f.store.catalogue.product(productId).variants;
  assert.deepEqual(
    after.map((v) => [v.id, v.size_milli, v.barcode]),
    [
      [one.id, 2000, "B"],
      [two.id, 1000, "A"],
    ],
  );
});

test("barcode lookup treats UPC-A and EAN-13 forms of a code as the same pack", (t) => {
  const f = fixture(t);
  const { variantId } = saveOne(f.store, {}, { barcode: "012345678905" });
  assert.equal(f.store.catalogue.variant(variantId).barcode, "0012345678905");
  assert.equal(
    f.store.catalogue.variantByBarcode("012345678905").id,
    variantId,
  );
  assert.equal(
    f.store.catalogue.variantByBarcode(" 0012345678905 ").id,
    variantId,
  );
  assert.equal(f.store.catalogue.variantByBarcode("999"), null);
});

test("product edits never change an earlier receipt", (t) => {
  const f = fixture(t);
  const { productId, variantId } = saveOne(f.store);
  f.store.cart.add(variantId);
  const saleId = randomUUID();
  f.store.sales.checkout(saleId);
  f.store.catalogue.saveProduct(
    product({ name: "Renamed", category: "New category" }, [
      size({ id: variantId, size_milli: 5000, price_cents: 5000, stock: 11 }),
    ]),
    productId,
  );
  const receipt = f.store.sales.items(saleId)[0];
  assert.equal(receipt.product_name, "Maize meal");
  assert.equal(receipt.variant_label, "2.5 kg");
  assert.equal(receipt.category, "Groceries");
  assert.equal(receipt.unit_price_cents, 3250);
  assert.equal(f.store.sales.list()[0].total_cents, 3250);
});

test("total overflow is rejected and its cart mutation is rolled back", (t) => {
  const f = fixture(t);
  const { variantId } = saveOne(
    f.store,
    {},
    { price_cents: Number.MAX_SAFE_INTEGER },
  );
  f.store.cart.add(variantId);
  assert.throws(() => f.store.cart.setQuantity(variantId, 2), /too large/);
  assert.equal(f.store.cart.items()[0].quantity, 1);
});

test("SQL-looking names are stored as data", (t) => {
  const f = fixture(t);
  const name = "O'Brien'); DROP TABLE products; --";
  const { productId } = saveOne(f.store, { name });
  assert.equal(f.store.catalogue.product(productId).name, name);
  assert.equal(f.store.catalogue.products().length, 1);
});

test("future database versions are rejected without deleting records", (t) => {
  const f = fixture(t);
  saveOne(f.store);
  f.db.execSync("PRAGMA user_version = 999");
  assert.throws(() => migrateDatabase(f.db), /newer Mokhotsi/);
  assert.equal(f.store.catalogue.products().length, 1);
});

test("upgrading a v1 database turns each product into one size and keeps the cart and receipts", (t) => {
  const f = fixture(t, { migrate: false });
  f.db.withTransactionSync(() => {
    MIGRATIONS[0].up(f.db);
    f.db.execSync("PRAGMA user_version = 1");
  });
  const now = new Date().toISOString();
  const insert = (id, name, price, stock, barcode) =>
    f.db.runSync(
      "INSERT INTO products (id, name, category, price_cents, stock, barcode, photo_uri, created_at, updated_at) VALUES (?, ?, 'Groceries', ?, ?, ?, NULL, ?, ?)",
      id,
      name,
      price,
      stock,
      barcode,
      now,
      now,
    );
  insert("p1", "Bread", 1800, 5, "012345678905");
  insert("p2", "Milk", 2200, 0, null);
  f.db.runSync(
    "INSERT INTO cart_items (product_id, quantity) VALUES ('p1', 2)",
  );
  f.db.runSync(
    "INSERT INTO sales (id, total_cents, created_at) VALUES ('s1', 2200, ?)",
    now,
  );
  f.db.runSync(
    "INSERT INTO sale_items (id, sale_id, product_id, product_name, category, barcode, quantity, unit_price_cents, line_total_cents) VALUES ('i1', 's1', 'p2', 'Milk', 'Groceries', NULL, 1, 2200, 2200)",
  );

  migrateDatabase(f.db);

  assert.equal(
    f.db.getFirstSync("PRAGMA user_version").user_version,
    SCHEMA_VERSION,
  );
  assert.equal(f.db.getFirstSync("PRAGMA foreign_keys").foreign_keys, 1);
  assert.equal(f.db.getFirstSync("PRAGMA foreign_key_check"), null);
  const bread = f.store.catalogue.product("p1");
  assert.equal(bread.variants.length, 1);
  assert.deepEqual(
    [
      bread.variants[0].id,
      bread.variants[0].unit,
      bread.variants[0].size_milli,
    ],
    ["p1", "pcs", 1000],
  );
  assert.equal(bread.variants[0].price_cents, 1800);
  assert.equal(bread.variants[0].stock, 5);
  assert.equal(
    f.store.catalogue.variantByBarcode("012345678905").product_id,
    "p1",
  );
  assert.equal(f.store.cart.items()[0].quantity, 2);
  assert.equal(f.store.sales.items("s1")[0].variant_label, "Each");
  f.store.sales.checkout(randomUUID());
  assert.equal(f.store.catalogue.variant("p1").stock, 3);
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
