import type { MatchMethod } from '@/contracts/sync';
import type { Uuid } from '@/lib/ids';
import type { Cents } from '@/lib/money';
import { notImplemented } from '@/lib/errors';
import type { Sale, SaleItem } from '@/db/schema';

export interface SaleLineInput {
  productId: Uuid;
  qty: number;
  unitPriceCents: Cents;
  /** Cosine similarity of the accepted match, null for barcode/manual. */
  matchScore: number | null;
  matchMethod: MatchMethod;
}

export interface RecordSaleInput {
  shopId: Uuid;
  deviceId: Uuid;
  lines: readonly SaleLineInput[];
}

export interface SaleWithItems {
  sale: Sale;
  items: SaleItem[];
}

/**
 * Write the sale, its items AND one `sales/upsert` outbox op in one transaction.
 * total_cents is computed here from integer cents, never passed in.
 * This is the checkout hot path: no network, no awaits inside the transaction.
 */
export function recordSale(input: RecordSaleInput): SaleWithItems {
  // TODO(feature): db.transaction((tx) => { insert sale; insert items; enqueue(tx, sales/upsert with items) }).
  return notImplemented('sales.recordSale');
}

export interface ListSalesOptions {
  limit: number;
  /** Epoch ms; return sales strictly older than this (keyset pagination). */
  before?: number;
}

export function listSales(shopId: Uuid, options: ListSalesOptions): Sale[] {
  // TODO(feature): select where shop_id = ? and created_at < ? order by created_at desc limit ? (sales_shop_created_idx).
  return notImplemented('sales.listSales');
}

export function getSale(id: Uuid): SaleWithItems | undefined {
  // TODO(feature): select sale + items (sale_items_sale_idx).
  return notImplemented('sales.getSale');
}
