import type { Uuid } from '@/lib/ids';
import type { Cents } from '@/lib/money';
import { notImplemented } from '@/lib/errors';
import type { Product, ProductImage } from '@/db/schema';

export interface UpsertProductInput {
  /** Omit to create a new product (a UUID is generated). */
  id?: Uuid;
  shopId: Uuid;
  name: string;
  priceCents: Cents;
  barcode: string | null;
}

/**
 * Create or update a product AND enqueue a `products/upsert` outbox op in one transaction.
 */
export function upsertProduct(input: UpsertProductInput): Product {
  // TODO(feature): db.transaction((tx) => { tx.insert(products)…onConflictDoUpdate…run(); enqueue(tx, …) }).
  return notImplemented('products.upsertProduct');
}

/** Soft-delete (deleted = true) AND enqueue a `products/upsert` op carrying deleted: true. */
export function softDeleteProduct(id: Uuid): void {
  // TODO(feature): one transaction: update products set deleted = 1, updated_at = now; enqueue(tx, …).
  return notImplemented('products.softDeleteProduct');
}

export function listProducts(shopId: Uuid): Product[] {
  // TODO(feature): select where shop_id = ? and deleted = 0 order by name.
  return notImplemented('products.listProducts');
}

export function getProduct(id: Uuid): Product | undefined {
  // TODO(feature): select by primary key.
  return notImplemented('products.getProduct');
}

export function findByBarcode(shopId: Uuid, barcode: string): Product | undefined {
  // TODO(feature): select where shop_id = ? and barcode = ? (uses products_shop_barcode_idx).
  return notImplemented('products.findByBarcode');
}

/** Enrolment photos stay on the device; they are not synced (not a sync entity). */
export function addProductImage(productId: Uuid, localUri: string): ProductImage {
  // TODO(feature): insert into product_images.
  return notImplemented('products.addProductImage');
}

export function listProductImages(productId: Uuid): ProductImage[] {
  // TODO(feature): select from product_images where product_id = ?.
  return notImplemented('products.listProductImages');
}
