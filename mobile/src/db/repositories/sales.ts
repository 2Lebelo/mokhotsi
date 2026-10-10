import { and, asc, desc, eq, lt } from 'drizzle-orm';

import type { MatchMethod } from '@/contracts/sync';
import { newId, type Uuid } from '@/lib/ids';
import { assertCents, sumCents, type Cents } from '@/lib/money';
import { msToIso } from '@/lib/time';
import { db } from '@/db/client';
import { notifyChanged } from '@/db/changes';
import { saleItems, sales, type Sale, type SaleItem } from '@/db/schema';

import { enqueue } from './outbox';

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

/** Wire payload for `sales/upsert` (contracts SaleRecord without `seq`; items embedded). */
export function salePayload({ sale, items }: SaleWithItems): Record<string, unknown> {
  return {
    id: sale.id,
    device_id: sale.deviceId,
    total_cents: sale.totalCents,
    items: items.map((i) => ({
      id: i.id,
      product_id: i.productId,
      qty: i.qty,
      unit_price_cents: i.unitPriceCents,
      match_score: i.matchScore,
      match_method: i.matchMethod,
    })),
    deleted: false,
    created_at: msToIso(sale.createdAt),
  };
}

/**
 * Write the sale, its items AND one `sales/upsert` outbox op in one transaction.
 * total_cents is computed here from integer cents, never passed in.
 * This is the checkout hot path: no network, no awaits inside the transaction.
 */
export function recordSale(input: RecordSaleInput): SaleWithItems {
  if (input.lines.length === 0) throw new TypeError('a sale needs at least one line');
  for (const line of input.lines) {
    if (!Number.isSafeInteger(line.qty) || line.qty < 1) {
      throw new TypeError(`qty must be a positive integer, got ${line.qty}`);
    }
    assertCents(line.unitPriceCents, 'unit price');
  }
  const sale: Sale = {
    id: newId(),
    shopId: input.shopId,
    totalCents: sumCents(input.lines.map((l) => l.qty * l.unitPriceCents)),
    createdAt: Date.now(),
    deviceId: input.deviceId,
  };
  const items: SaleItem[] = input.lines.map((l) => ({
    id: newId(),
    saleId: sale.id,
    productId: l.productId,
    qty: l.qty,
    unitPriceCents: l.unitPriceCents,
    matchScore: l.matchScore,
    matchMethod: l.matchMethod,
  }));
  db.transaction((tx) => {
    tx.insert(sales).values(sale).run();
    tx.insert(saleItems).values(items).run();
    enqueue(tx, { entity: 'sales', entityId: sale.id, op: 'upsert', payload: salePayload({ sale, items }) });
  });
  notifyChanged('sales', 'outbox');
  return { sale, items };
}

export interface ListSalesOptions {
  limit: number;
  /** Epoch ms; return sales strictly older than this (keyset pagination). */
  before?: number;
}

export function listSales(shopId: Uuid, options: ListSalesOptions): Sale[] {
  const where =
    options.before === undefined
      ? eq(sales.shopId, shopId)
      : and(eq(sales.shopId, shopId), lt(sales.createdAt, options.before));
  return db.select().from(sales).where(where).orderBy(desc(sales.createdAt)).limit(options.limit).all();
}

export function getSale(id: Uuid): SaleWithItems | undefined {
  const sale = db.select().from(sales).where(eq(sales.id, id)).get();
  if (!sale) return undefined;
  const items = db.select().from(saleItems).where(eq(saleItems.saleId, id)).orderBy(asc(saleItems.id)).all();
  return { sale, items };
}
