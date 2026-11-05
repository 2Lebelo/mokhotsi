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
import type { ProductPayload } from "../../contracts/sync.ts";
import type { OutboxRepository } from "./outbox.ts";
import {
  nonNegativeInteger,
  SELLABLE_COLUMNS,
  type StoreContext,
} from "./shared.ts";
import type { StockLedger } from "./stock.ts";

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
  const cost = input.cost_cents ?? null;
  if (cost !== null) nonNegativeInteger(cost, "Cost price");
  nonNegativeInteger(input.stock, "Stock");
  if (
    input.stock_baseline !== undefined &&
    !Number.isSafeInteger(input.stock_baseline)
  )
    throw new Error("The stock this size was edited from is not valid.");
  const barcode = normalizeBarcode(input.barcode);
  if (barcode) assertValidBarcode(barcode);
  return { ...input, cost_cents: cost, barcode };
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
  private context: StoreContext;
  private outbox: OutboxRepository;
  private stock: StockLedger;

  constructor(
    db: SQLiteDatabase,
    context: StoreContext,
    outbox: OutboxRepository,
    stock: StockLedger,
  ) {
    this.db = db;
    this.context = context;
    this.outbox = outbox;
    this.stock = stock;
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
      }>(
        "SELECT DISTINCT category FROM products ORDER BY category COLLATE NOCASE",
      )
      .map((row) => row.category);
  }

  /**
   * Creates or updates a product and its sizes in one transaction. Sizes left out
   * of `input.variants` are archived, never deleted, because receipts reference them.
   * Stock is never overwritten: a new size records its opening stock, and an edited
   * figure records the difference from `stock_baseline` as an adjustment.
   */
  saveProduct(input: ProductInput, id?: string): string {
    const name = input.name.trim();
    const category = input.category.trim();
    if (!name) throw new Error("Enter a product name.");
    if (!category) throw new Error("Enter a category.");
    if (!input.variants.length) throw new Error("Add at least one size.");
    const variants = input.variants.map(normalizeVariant);
    assertDistinct(variants);
    const productId = id ?? this.context.newId();
    const now = this.context.clock().toISOString();

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

      let active = new Map<string, number>();
      if (id) {
        // A photo kept as it was keeps its hash; a new one takes the given hash, if any.
        // (SET expressions see the row as it was before this update.)
        const updated = this.db.runSync(
          `UPDATE products SET name = ?, category = ?, photo_uri = ?, photo2_uri = ?,
             photo_hash = COALESCE(?, CASE WHEN photo_uri IS ? THEN photo_hash END),
             photo2_hash = COALESCE(?, CASE WHEN photo2_uri IS ? THEN photo2_hash END),
             updated_at = ? WHERE id = ?`,
          name,
          category,
          input.photo_uri,
          input.photo2_uri ?? null,
          input.photo_hash ?? null,
          input.photo_uri,
          input.photo2_hash ?? null,
          input.photo2_uri ?? null,
          now,
          id,
        );
        if (updated.changes !== 1)
          throw new Error("This product no longer exists.");
        active = new Map(
          this.db
            .getAllSync<{
              id: string;
              stock: number;
            }>(
              "SELECT id, stock FROM product_variants WHERE product_id = ? AND archived_at IS NULL",
              id,
            )
            .map((row) => [row.id, row.stock]),
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
          "INSERT INTO products (id, name, category, photo_uri, photo2_uri, photo_hash, photo2_hash, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
          productId,
          name,
          category,
          input.photo_uri,
          input.photo2_uri ?? null,
          input.photo_uri ? (input.photo_hash ?? null) : null,
          input.photo2_uri ? (input.photo2_hash ?? null) : null,
          now,
          now,
        );
      }

      const movements: { variantId: string; delta: number; opening: boolean }[] =
        [];
      variants.forEach((variant, position) => {
        const current = variant.id ? active.get(variant.id) : undefined;
        if (variant.id && current !== undefined) {
          this.db.runSync(
            "UPDATE product_variants SET size_milli = ?, unit = ?, price_cents = ?, cost_cents = ?, barcode = ?, position = ?, archived_at = NULL, updated_at = ? WHERE id = ?",
            variant.size_milli,
            variant.unit,
            variant.price_cents,
            variant.cost_cents ?? null,
            variant.barcode,
            position,
            now,
            variant.id,
          );
          movements.push({
            variantId: variant.id,
            delta: variant.stock - (variant.stock_baseline ?? current),
            opening: false,
          });
        } else {
          const variantId = this.context.newId();
          this.db.runSync(
            "INSERT INTO product_variants (id, product_id, size_milli, unit, price_cents, cost_cents, stock, barcode, position, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?)",
            variantId,
            productId,
            variant.size_milli,
            variant.unit,
            variant.price_cents,
            variant.cost_cents ?? null,
            variant.barcode,
            position,
            now,
            now,
          );
          movements.push({ variantId, delta: variant.stock, opening: true });
        }
      });

      this.db.runSync(
        "DELETE FROM cart_items WHERE variant_id IN (SELECT id FROM product_variants WHERE product_id = ? AND archived_at IS NOT NULL)",
        productId,
      );
      // The product is queued before its movements so the server knows every size first.
      this.outbox.record("products", productId, this.payload(productId));
      for (const { variantId, delta, opening } of movements)
        this.stock.move(variantId, delta, opening ? "opening" : "adjustment");
    });
    return productId;
  }

  /** The product with every size, archived ones included, as it is sent to the server. */
  payload(productId: string): ProductPayload {
    const product = this.db.getFirstSync<Product>(
      "SELECT * FROM products WHERE id = ?",
      productId,
    );
    if (!product) throw new Error("This product no longer exists.");
    const variants = this.db.getAllSync<Variant>(
      "SELECT * FROM product_variants WHERE product_id = ? ORDER BY position, id",
      productId,
    );
    return {
      id: product.id,
      name: product.name,
      category: product.category,
      // A photo travels by hash once it has one (reconcile hashes older photos).
      photos: [
        ...(product.photo_uri && product.photo_hash
          ? [{ slot: 0 as const, sha256: product.photo_hash }]
          : []),
        ...(product.photo2_uri && product.photo2_hash
          ? [{ slot: 1 as const, sha256: product.photo2_hash }]
          : []),
      ],
      updated_by: this.context.actor.userId,
      created_at: product.created_at,
      updated_at: product.updated_at,
      variants: variants.map((variant) => ({
        id: variant.id,
        size_milli: variant.size_milli,
        unit: variant.unit,
        price_cents: variant.price_cents,
        cost_cents: variant.cost_cents,
        barcode: variant.barcode,
        position: variant.position,
        archived_at: variant.archived_at,
      })),
    };
  }

  /** Whether any product still shows this file (it must not be deleted). */
  photoInUse(uri: string): boolean {
    return (
      this.db.getFirstSync(
        "SELECT 1 FROM products WHERE photo_uri = ? OR photo2_uri = ? LIMIT 1",
        uri,
        uri,
      ) !== null
    );
  }

  /** Product photos with no content hash yet (saved before photos were synced). */
  unhashedPhotos(limit = 1_000): string[] {
    return this.db
      .getAllSync<{ uri: string }>(
        `SELECT photo_uri AS uri FROM products WHERE photo_uri IS NOT NULL AND photo_hash IS NULL
         UNION
         SELECT photo2_uri FROM products WHERE photo2_uri IS NOT NULL AND photo2_hash IS NULL
         LIMIT ?`,
        limit,
      )
      .map((row) => row.uri);
  }

  /**
   * Records the hash of a photo file on every product showing it, and queues those products
   * again so the server learns their photos.
   */
  setPhotoHash(uri: string, sha256: string): void {
    this.db.withTransactionSync(() => {
      const products = this.db
        .getAllSync<{ id: string }>(
          "SELECT id FROM products WHERE photo_uri = ? OR photo2_uri = ?",
          uri,
          uri,
        )
        .map((row) => row.id);
      this.db.runSync(
        "UPDATE products SET photo_hash = ? WHERE photo_uri = ? AND photo_hash IS NULL",
        sha256,
        uri,
      );
      this.db.runSync(
        "UPDATE products SET photo2_hash = ? WHERE photo2_uri = ? AND photo2_hash IS NULL",
        sha256,
        uri,
      );
      for (const id of products) this.outbox.record("products", id, this.payload(id));
    });
  }

  /** Inside a transaction: queues every product, for a shop's first upload. */
  queueAll(): void {
    for (const { id } of this.db.getAllSync<{ id: string }>(
      "SELECT id FROM products ORDER BY created_at, id",
    ))
      this.outbox.record("products", id, this.payload(id));
  }
}
