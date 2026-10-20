import type { Migration } from "./types.ts";

export const initial: Migration = {
  version: 1,
  name: "initial",
  up: (db) =>
    db.execSync(`
      CREATE TABLE products (
        id TEXT PRIMARY KEY NOT NULL,
        name TEXT NOT NULL CHECK(length(trim(name)) > 0),
        category TEXT NOT NULL CHECK(length(trim(category)) > 0),
        price_cents INTEGER NOT NULL CHECK(price_cents >= 0 AND price_cents <= 9007199254740991),
        stock INTEGER NOT NULL CHECK(stock >= 0 AND stock <= 9007199254740991),
        barcode TEXT,
        photo_uri TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE UNIQUE INDEX products_barcode ON products(barcode) WHERE barcode IS NOT NULL;
      CREATE INDEX products_name ON products(name COLLATE NOCASE);
      CREATE INDEX products_category ON products(category COLLATE NOCASE);
      CREATE TABLE cart_items (
        product_id TEXT PRIMARY KEY NOT NULL REFERENCES products(id),
        quantity INTEGER NOT NULL CHECK(quantity > 0 AND quantity <= 9007199254740991)
      );
      CREATE TABLE sales (
        id TEXT PRIMARY KEY NOT NULL,
        total_cents INTEGER NOT NULL CHECK(total_cents >= 0 AND total_cents <= 9007199254740991),
        created_at TEXT NOT NULL
      );
      CREATE INDEX sales_date ON sales(created_at DESC);
      CREATE TABLE sale_items (
        id TEXT PRIMARY KEY NOT NULL,
        sale_id TEXT NOT NULL REFERENCES sales(id),
        product_id TEXT NOT NULL REFERENCES products(id),
        product_name TEXT NOT NULL,
        category TEXT NOT NULL,
        barcode TEXT,
        quantity INTEGER NOT NULL CHECK(quantity > 0),
        unit_price_cents INTEGER NOT NULL CHECK(unit_price_cents >= 0),
        line_total_cents INTEGER NOT NULL CHECK(line_total_cents >= 0)
      );
      CREATE INDEX sale_items_sale ON sale_items(sale_id);
    `),
};
