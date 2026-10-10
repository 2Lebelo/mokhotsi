import { and, asc, eq } from 'drizzle-orm';

import type { Uuid } from '@/lib/ids';
import { newId } from '@/lib/ids';
import { assertCents, type Cents } from '@/lib/money';
import { msToIso } from '@/lib/time';
import { db } from '@/db/client';
import { notifyChanged } from '@/db/changes';
import { productImages, products, type Product, type ProductImage } from '@/db/schema';

import { enqueue } from './outbox';

export interface UpsertProductInput {
  /** Omit to create a new product (a UUID is generated). */
  id?: Uuid;
  shopId: Uuid;
  name: string;
  priceCents: Cents;
  barcode: string | null;
}

/** Wire payload for `products/upsert` (contracts ProductRecord without `seq`). */
export function productPayload(p: Product): Record<string, unknown> {
  return {
    id: p.id,
    name: p.name,
    price_cents: p.priceCents,
    barcode: p.barcode,
    deleted: p.deleted,
    updated_at: msToIso(p.updatedAt),
  };
}

/**
 * Create or update a product AND enqueue a `products/upsert` outbox op in one transaction.
 */
export function upsertProduct(input: UpsertProductInput): Product {
  const name = input.name.trim();
  if (name.length === 0) throw new TypeError('product name is required');
  assertCents(input.priceCents, 'price');
  if (input.priceCents < 0) throw new TypeError('price cannot be negative');
  const product: Product = {
    id: input.id ?? newId(),
    shopId: input.shopId,
    name,
    priceCents: input.priceCents,
    barcode: input.barcode?.trim() || null,
    updatedAt: Date.now(),
    deleted: false,
  };
  db.transaction((tx) => {
    tx.insert(products)
      .values(product)
      .onConflictDoUpdate({
        target: products.id,
        set: {
          name: product.name,
          priceCents: product.priceCents,
          barcode: product.barcode,
          updatedAt: product.updatedAt,
          deleted: false,
        },
      })
      .run();
    enqueue(tx, { entity: 'products', entityId: product.id, op: 'upsert', payload: productPayload(product) });
  });
  notifyChanged('products', 'outbox');
  return product;
}

/** Soft-delete (deleted = true) AND enqueue a `products/upsert` op carrying deleted: true. */
export function softDeleteProduct(id: Uuid): void {
  const existing = getProduct(id);
  if (!existing || existing.deleted) return;
  const deleted: Product = { ...existing, deleted: true, updatedAt: Date.now() };
  db.transaction((tx) => {
    tx.update(products).set({ deleted: true, updatedAt: deleted.updatedAt }).where(eq(products.id, id)).run();
    enqueue(tx, { entity: 'products', entityId: id, op: 'upsert', payload: productPayload(deleted) });
  });
  notifyChanged('products', 'outbox');
}

export function listProducts(shopId: Uuid): Product[] {
  return db
    .select()
    .from(products)
    .where(and(eq(products.shopId, shopId), eq(products.deleted, false)))
    .orderBy(asc(products.name))
    .all();
}

export function getProduct(id: Uuid): Product | undefined {
  return db.select().from(products).where(eq(products.id, id)).get();
}

export function findByBarcode(shopId: Uuid, barcode: string): Product | undefined {
  return db
    .select()
    .from(products)
    .where(and(eq(products.shopId, shopId), eq(products.barcode, barcode), eq(products.deleted, false)))
    .get();
}

/** Enrolment photos stay on the device; they are not synced (not a sync entity). */
export function addProductImage(productId: Uuid, localUri: string): ProductImage {
  const image: ProductImage = { id: newId(), productId, localUri };
  db.insert(productImages).values(image).run();
  notifyChanged('product_images');
  return image;
}

export function listProductImages(productId: Uuid): ProductImage[] {
  return db.select().from(productImages).where(eq(productImages.productId, productId)).all();
}
