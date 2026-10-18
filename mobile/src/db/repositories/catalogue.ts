import type { SQLiteDatabase } from "expo-sqlite";

import { assertValidBarcode, normalizeBarcode } from "../../domain/barcode.ts";
import { assertValidSize, variantLabel } from "../../domain/units.ts";
import type {
  Product,
  ProductInput,
  ProductWithVariants,
  SellableVariant,
  Variant,
  VariantInput,
} from "../types.ts";
import {
  nonNegativeInteger,
  SELLABLE_COLUMNS,
  type IdFactory,
} from "./shared.ts";

export function toSellable(
  product: Product,
  variant: Variant,
): SellableVariant {
  return {
    ...variant,
    product_name: product.name,
    category: product.category,
    photo_uri: product.photo_uri,
  };
}

function normalizeVariant(input: VariantInput): VariantInput {
  assertValidSize(input.size_milli, input.unit);
  nonNegativeInteger(input.price_cents, "Price");
  nonNegativeInteger(input.stock, "Stock");
  const barcode = normalizeBarcode(input.barcode);
  if (barcode) assertValidBarcode(barcode);
  return { ...input, barcode };
}

function assertDistinct(variants: VariantInput[]): void {
  const sizes = new Set<string>();
  const barcodes = new Set<string>();
  for (const variant of variants) {
    const size = `${variant.unit}:${variant.size_milli}`;
    if (sizes.has(size))
      throw new Error(
        `Two sizes are both ${variantLabel(variant)}. Give each size a different amount or unit.`,
      );
    sizes.add(size);
    if (variant.barcode) {
      if (barcodes.has(variant.barcode))
        throw new Error(
          `Barcode ${variant.barcode} is entered for two sizes. Each size needs its own barcode.`,
        );
      barcodes.add(variant.barcode);
    }
  }
}

export class CatalogueRepository {
  private db: SQLiteDatabase;
  private newId: IdFactory;

  constructor(db: SQLiteDatabase, newId: IdFactory) {
    this.db = db;
    this.newId = newId;
  }

  /** Every product with its active sizes, in two queries. */
  products(): ProductWithVariants[] {
    const products = this.db.getAllSync<Product>(
      "SELECT * FROM products ORDER BY name COLLATE NOCASE, id",
    );
    const variants = this.db.getAllSync<Variant>(
      "SELECT * FROM product_variants WHERE archived_at IS NULL ORDER BY position, id",
    );
    const byProduct = new Map<string, Variant[]>();
    for (const variant of variants) {
      const list = byProduct.get(variant.product_id);
      if (list) list.push(variant);
      else byProduct.set(variant.product_id, [variant]);
    }
    return products.map((product) => ({
      ...product,
      variants: byProduct.get(product.id) ?? [],
    }));
  }

  product(id: string): ProductWithVariants | null {
    const product = this.db.getFirstSync<Product>(
      "SELECT * FROM products WHERE id = ?",
      id,
    );
    if (!product) return null;
    const variants = this.db.getAllSync<Variant>(
      "SELECT * FROM product_variants WHERE product_id = ? AND archived_at IS NULL ORDER BY position, id",
      id,
    );
    return { ...product, variants };
  }

  /** A size by id, including archived sizes so receipts and carts can explain them. */
  variant(id: string): SellableVariant | null {
    return this.db.getFirstSync<SellableVariant>(
      `SELECT ${SELLABLE_COLUMNS} FROM product_variants v JOIN products p ON p.id = v.product_id WHERE v.id = ?`,
      id,
    );
  }

  variantByBarcode(raw: string): SellableVariant | null {
    const barcode = normalizeBarcode(raw);
    if (!barcode) return null;
    return this.db.getFirstSync<SellableVariant>(
      `SELECT ${SELLABLE_COLUMNS} FROM product_variants v JOIN products p ON p.id = v.product_id WHERE v.barcode = ? AND v.archived_at IS NULL`,
      barcode,
    );
  }

  categories(): string[] {
    return this.db
      .getAllSync<{
        category: string;
      }>("SELECT DISTINCT category FROM products ORDER BY category COLLATE NOCASE")
      .map((row) => row.category);
  }

  /**
   * Creates or updates a product and its sizes in one transaction. Sizes left out
   * of `input.variants` are archived, never deleted, because receipts reference them.
   */
  saveProduct(input: ProductInput, id?: string): string {
    const name = input.name.trim();
    const category = input.category.trim();
    if (!name) throw new Error("Enter a product name.");
    if (!category) throw new Error("Enter a category.");
    if (!input.variants.length) throw new Error("Add at least one size.");
    const variants = input.variants.map(normalizeVariant);
    assertDistinct(variants);
    const productId = id ?? this.newId();
    const now = new Date().toISOString();

    this.db.withTransactionSync(() => {
      for (const variant of variants) {
        if (!variant.barcode) continue;
        const owner = this.db.getFirstSync<SellableVariant>(
          `SELECT ${SELLABLE_COLUMNS} FROM product_variants v JOIN products p ON p.id = v.product_id WHERE v.barcode = ? AND v.archived_at IS NULL AND v.product_id <> ?`,
          variant.barcode,
          productId,
        );
        if (owner)
          throw new Error(
            `Barcode ${variant.barcode} already belongs to ${owner.product_name} · ${variantLabel(owner)}.`,
          );
      }

      let active = new Set<string>();
      if (id) {
        const updated = this.db.runSync(
          "UPDATE products SET name = ?, category = ?, photo_uri = ?, updated_at = ? WHERE id = ?",
          name,
          category,
          input.photo_uri,
          now,
          id,
        );
        if (updated.changes !== 1)
          throw new Error("This product no longer exists.");
        active = new Set(
          this.db
            .getAllSync<{
              id: string;
            }>("SELECT id FROM product_variants WHERE product_id = ? AND archived_at IS NULL", id)
            .map((row) => row.id),
        );
        // Deactivate every size, then reactivate the kept ones with their new values,
        // so swapping barcodes or sizes between rows never trips a unique index midway.
        this.db.runSync(
          "UPDATE product_variants SET archived_at = ? WHERE product_id = ? AND archived_at IS NULL",
          now,
          id,
        );
      } else {
        this.db.runSync(
          "INSERT INTO products (id, name, category, photo_uri, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
          productId,
          name,
          category,
          input.photo_uri,
          now,
          now,
        );
      }

      variants.forEach((variant, position) => {
        if (variant.id && active.has(variant.id)) {
          this.db.runSync(
            "UPDATE product_variants SET size_milli = ?, unit = ?, price_cents = ?, stock = ?, barcode = ?, position = ?, archived_at = NULL, updated_at = ? WHERE id = ?",
            variant.size_milli,
            variant.unit,
            variant.price_cents,
            variant.stock,
            variant.barcode,
            position,
            now,
            variant.id,
          );
        } else {
          this.db.runSync(
            "INSERT INTO product_variants (id, product_id, size_milli, unit, price_cents, stock, barcode, position, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            this.newId(),
            productId,
            variant.size_milli,
            variant.unit,
            variant.price_cents,
            variant.stock,
            variant.barcode,
            position,
            now,
            now,
          );
        }
      });

      this.db.runSync(
        "DELETE FROM cart_items WHERE variant_id IN (SELECT id FROM product_variants WHERE product_id = ? AND archived_at IS NOT NULL)",
        productId,
      );
    });
    return productId;
  }
}
