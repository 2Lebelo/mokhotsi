/**
 * Phase 5 requirement: the outbox row is created atomically with a sale (one transaction).
 */
import type { DatabaseSync } from 'node:sqlite';

import { needsAttention, peekBatch, pendingCount, unsyncedSalesCount } from '@/db/repositories/outbox';
import { upsertProduct } from '@/db/repositories/products';
import { getSale, recordSale } from '@/db/repositories/sales';

import { resetTables } from './support/testDb';

jest.mock('@/db/client', () => require('./support/testDb').mockClientModule());

const client = (jest.requireMock('@/db/client') as { __client: DatabaseSync }).__client;
const SHOP = 'b0c4b7d8-6a0e-4c55-9b51-2f3c1a0e9d11';
const DEVICE = '7d0f6a8e-2b1c-4f3a-9e5d-1a2b3c4d5e6f';

function count(table: string): number {
  return (client.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number }).n;
}

beforeEach(() => resetTables(client));

describe('recordSale', () => {
  it('writes the sale, its items and exactly one sales/upsert outbox op together', () => {
    const maize = upsertProduct({ shopId: SHOP, name: 'Maize meal 2.5kg', priceCents: 4599, barcode: null });
    const sugar = upsertProduct({ shopId: SHOP, name: 'Sugar 1kg', priceCents: 2150, barcode: null });
    resetOutbox();

    const { sale, items } = recordSale({
      shopId: SHOP,
      deviceId: DEVICE,
      lines: [
        { productId: maize.id, qty: 2, unitPriceCents: 4599, matchScore: 0.91, matchMethod: 'vision' },
        { productId: sugar.id, qty: 1, unitPriceCents: 2150, matchScore: null, matchMethod: 'manual' },
      ],
    });

    expect(sale.totalCents).toBe(2 * 4599 + 2150); // Computed from integer cents.
    expect(getSale(sale.id)?.items).toHaveLength(2);
    expect(count('sales')).toBe(1);
    expect(count('sale_items')).toBe(2);

    const [op, ...rest] = peekBatch(10);
    expect(rest).toEqual([]);
    expect(op).toMatchObject({ entity: 'sales', entityId: sale.id, op: 'upsert', attempts: 0 });
    const payload = JSON.parse(op!.payload);
    expect(payload).toEqual({
      id: sale.id,
      device_id: DEVICE,
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
      created_at: new Date(sale.createdAt).toISOString(),
    });
    expect(unsyncedSalesCount()).toBe(1);
  });

  it('rolls everything back when any write in the transaction fails', () => {
    const maize = upsertProduct({ shopId: SHOP, name: 'Maize meal 2.5kg', priceCents: 4599, barcode: null });
    resetOutbox();

    // The second line references a product that does not exist: the sale row is inserted first,
    // then the items insert violates the foreign key and the whole transaction must roll back.
    expect(() =>
      recordSale({
        shopId: SHOP,
        deviceId: DEVICE,
        lines: [
          { productId: maize.id, qty: 1, unitPriceCents: 4599, matchScore: null, matchMethod: 'manual' },
          {
            productId: '00000000-0000-4000-8000-000000000000',
            qty: 1,
            unitPriceCents: 100,
            matchScore: null,
            matchMethod: 'manual',
          },
        ],
      }),
    ).toThrow();

    expect(count('sales')).toBe(0);
    expect(count('sale_items')).toBe(0);
    expect(pendingCount()).toBe(0);
  });

  it('rejects invalid input before touching the database', () => {
    expect(() => recordSale({ shopId: SHOP, deviceId: DEVICE, lines: [] })).toThrow(/at least one line/);
    expect(() =>
      recordSale({
        shopId: SHOP,
        deviceId: DEVICE,
        lines: [{ productId: 'x', qty: 1, unitPriceCents: 12.5, matchScore: null, matchMethod: 'manual' }],
      }),
    ).toThrow(/integer number of cents/);
    expect(count('sales')).toBe(0);
    expect(needsAttention()).toEqual([]);
  });
});

describe('upsertProduct', () => {
  it('writes the product and a products/upsert op in one transaction', () => {
    const product = upsertProduct({ shopId: SHOP, name: '  Bread ', priceCents: 1400, barcode: '600123' });
    expect(product.name).toBe('Bread');
    const ops = peekBatch(10);
    expect(ops).toHaveLength(1);
    expect(ops[0]).toMatchObject({ entity: 'products', entityId: product.id, op: 'upsert' });
    expect(JSON.parse(ops[0]!.payload)).toMatchObject({ id: product.id, price_cents: 1400, deleted: false });
  });
});

function resetOutbox(): void {
  client.exec('DELETE FROM outbox;');
}
