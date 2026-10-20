import type { Migration } from "./types.ts";

// Moves price, stock, and barcode from products onto product sizes (variants).
// Tables are rebuilt with SQLite's documented procedure: create, copy, drop, rename.
// Each v1 product becomes one "Each" size that reuses the product id, so existing
// cart rows and receipts map onto it without generating ids in SQL.
export const productVariants: Migration = {
  version: 2,
  name: "product-variants",
  up: (db) =>
    db.execSync(`
      CREATE TABLE products_v2 (
        id TEXT PRIMARY KEY NOT NULL,
        name TEXT NOT NULL CHECK(length(trim(name)) > 0),
        category TEXT NOT NULL CHECK(length(trim(category)) > 0),
        photo_uri TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      INSERT INTO products_v2 (id, name, category, photo_uri, created_at, updated_at)
        SELECT id, name, category, photo_uri, created_at, updated_at FROM products;

      CREATE TABLE product_variants (
        id TEXT PRIMARY KEY NOT NULL,
        product_id TEXT NOT NULL REFERENCES products(id),
        size_milli INTEGER NOT NULL CHECK(size_milli > 0 AND size_milli <= 9007199254740991),
        unit TEXT NOT NULL CHECK(length(unit) > 0),
        price_cents INTEGER NOT NULL CHECK(price_cents >= 0 AND price_cents <= 9007199254740991),
        stock INTEGER NOT NULL CHECK(stock >= 0 AND stock <= 9007199254740991),
        barcode TEXT,
        position INTEGER NOT NULL DEFAULT 0,
        archived_at TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      INSERT INTO product_variants (id, product_id, size_milli, unit, price_cents, stock, barcode, position, created_at, updated_at)
        SELECT id, id, 1000, 'pcs', price_cents, stock, barcode, 0, created_at, updated_at FROM products;
      -- Store UPC-A codes in their EAN-13 form, unless that would collide with a saved code.
      UPDATE product_variants SET barcode = '0' || barcode
        WHERE length(barcode) = 12 AND barcode NOT GLOB '*[^0-9]*'
          AND NOT EXISTS (SELECT 1 FROM product_variants other WHERE other.barcode = '0' || product_variants.barcode);

      CREATE TABLE cart_items_v2 (
        variant_id TEXT PRIMARY KEY NOT NULL REFERENCES product_variants(id),
        quantity INTEGER NOT NULL CHECK(quantity > 0 AND quantity <= 9007199254740991)
      );
      INSERT INTO cart_items_v2 (variant_id, quantity) SELECT product_id, quantity FROM cart_items;

      CREATE TABLE sale_items_v2 (
        id TEXT PRIMARY KEY NOT NULL,
        sale_id TEXT NOT NULL REFERENCES sales(id),
        product_id TEXT NOT NULL REFERENCES products(id),
        variant_id TEXT NOT NULL REFERENCES product_variants(id),
        product_name TEXT NOT NULL,
        variant_label TEXT NOT NULL,
        category TEXT NOT NULL,
        barcode TEXT,
        quantity INTEGER NOT NULL CHECK(quantity > 0),
        unit_price_cents INTEGER NOT NULL CHECK(unit_price_cents >= 0),
        line_total_cents INTEGER NOT NULL CHECK(line_total_cents >= 0)
      );
      INSERT INTO sale_items_v2 (id, sale_id, product_id, variant_id, product_name, variant_label, category, barcode, quantity, unit_price_cents, line_total_cents)
        SELECT id, sale_id, product_id, product_id, product_name, 'Each', category, barcode, quantity, unit_price_cents, line_total_cents FROM sale_items;

      DROP TABLE cart_items;
      DROP TABLE sale_items;
      DROP TABLE products;
      ALTER TABLE products_v2 RENAME TO products;
      ALTER TABLE cart_items_v2 RENAME TO cart_items;
      ALTER TABLE sale_items_v2 RENAME TO sale_items;

      CREATE INDEX products_name ON products(name COLLATE NOCASE);
      CREATE INDEX products_category ON products(category COLLATE NOCASE);
      CREATE UNIQUE INDEX variants_barcode ON product_variants(barcode)
        WHERE barcode IS NOT NULL AND archived_at IS NULL;
      CREATE UNIQUE INDEX variants_size ON product_variants(product_id, unit, size_milli)
        WHERE archived_at IS NULL;
      CREATE INDEX variants_product ON product_variants(product_id, position);
      CREATE INDEX sale_items_sale ON sale_items(sale_id);
    `),
};
