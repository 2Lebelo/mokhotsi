/**
 * Phase 5 requirement: a pulled record is skipped while a local op for it is pending. Also:
 * the cursor is saved only after the whole page applies, and pull() re-reads an overlap.
 */
import type { DatabaseSync } from 'node:sqlite';

import type { ProductRecord, PullChanges, PullResponse, SaleRecord } from '@/contracts/sync';
import { getProduct, upsertProduct } from '@/db/repositories/products';
import { getSale } from '@/db/repositories/sales';
import { applyPulledPage, getSyncValue, setSyncValue } from '@/db/repositories/syncState';
import { float32ToBase64 } from '@/lib/base64';
import type { ApiClient } from '@/sync/apiClient';
import { pull, PULL_OVERLAP, requestCursor } from '@/sync/pull';

import { resetTables } from './support/testDb';

jest.mock('@/db/client', () => require('./support/testDb').mockClientModule());

const client = (jest.requireMock('@/db/client') as { __client: DatabaseSync }).__client;
const SHOP = 'b0c4b7d8-6a0e-4c55-9b51-2f3c1a0e9d11';
const NOW = '2026-10-06T09:15:00.000Z';

function product(id: string, name: string, seq: number, extra: Partial<ProductRecord> = {}): ProductRecord {
  return { id, name, price_cents: 1000, barcode: null, deleted: false, updated_at: NOW, seq, ...extra };
}

function page(changes: Partial<PullChanges>): PullChanges {
  return { products: [], embeddings: [], sales: [], ...changes };
}

beforeEach(() => resetTables(client));

describe('applyPulledPage', () => {
  it('skips a pulled record while a local op for it is pending, and applies the rest', () => {
    const local = upsertProduct({
      shopId: SHOP,
      name: 'Local name (not pushed yet)',
      priceCents: 500,
      barcode: null,
    });
    const otherId = '1f0e2d3c-4b5a-4968-8776-655443322110';

    const result = applyPulledPage(
      SHOP,
      page({ products: [product(local.id, 'Server name', 7), product(otherId, 'Sugar 1kg', 8)] }),
      '8',
    );

    expect(result).toEqual({ applied: 1, skipped: 1 });
    expect(getProduct(local.id)?.name).toBe('Local name (not pushed yet)');
    expect(getProduct(otherId)).toMatchObject({ name: 'Sugar 1kg', shopId: SHOP, deleted: false });
    expect(getSyncValue('pull_cursor')).toBe('8');
    // Pulled changes never create outbox rows.
    expect((client.prepare('SELECT COUNT(*) AS n FROM outbox').get() as { n: number }).n).toBe(1);
  });

  it('applies soft deletes, embeddings and insert-only sales', () => {
    const p = '3f2a1b4c-5d6e-4f70-8a9b-0c1d2e3f4a5b';
    const e = '6b5a4c3d-2e1f-4a0b-9c8d-7e6f5a4b3c2d';
    const s = '9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d';
    const sale: SaleRecord = {
      id: s,
      device_id: '7d0f6a8e-2b1c-4f3a-9e5d-1a2b3c4d5e6f',
      total_cents: 2000,
      items: [
        {
          id: 'aa8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d',
          product_id: p,
          qty: 2,
          unit_price_cents: 1000,
          match_score: null,
          match_method: 'manual',
        },
      ],
      deleted: false,
      created_at: NOW,
      seq: 3,
    };
    applyPulledPage(
      SHOP,
      page({
        products: [product(p, 'Maize', 1)],
        embeddings: [
          {
            id: e,
            product_id: p,
            vector_b64: float32ToBase64(Float32Array.from([1, 0, 0, 0])),
            dim: 4,
            model_version: 'test@1',
            deleted: false,
            created_at: NOW,
            seq: 2,
          },
        ],
        sales: [sale],
      }),
      '3',
    );
    expect(getSale(s)?.items).toHaveLength(1);
    const vector = client.prepare('SELECT vector FROM embeddings WHERE id = ?').get(e) as {
      vector: Uint8Array;
    };
    expect(Array.from(new Float32Array(Uint8Array.from(vector.vector).buffer))).toEqual([1, 0, 0, 0]);

    // The same sale again (an overlapping pull) is skipped: sales are insert-only.
    expect(applyPulledPage(SHOP, page({ sales: [{ ...sale, total_cents: 1 }] }), '3')).toEqual({
      applied: 0,
      skipped: 1,
    });
    expect(getSale(s)?.sale.totalCents).toBe(2000);

    // Then the product is deleted, together with its embedding.
    applyPulledPage(
      SHOP,
      page({
        products: [product(p, 'Maize', 4, { deleted: true })],
        embeddings: [
          {
            id: e,
            product_id: p,
            vector_b64: '',
            dim: 4,
            model_version: 'test@1',
            deleted: true,
            created_at: NOW,
            seq: 5,
          },
        ],
      }),
      '5',
    );
    expect(getProduct(p)?.deleted).toBe(true);
    expect(client.prepare('SELECT COUNT(*) AS n FROM embeddings').get()).toEqual({ n: 0 });
  });

  it('does not move the cursor when any record in the page fails to apply', () => {
    setSyncValue('pull_cursor', '10');
    const good = product('5d4c3b2a-1f0e-4d9c-8b7a-695847362514', 'Good', 11);
    const bad = product('6e5d4c3b-2a1f-4e0d-9c8b-7a6958473625', 'Bad timestamp', 12, { updated_at: 'nope' });

    expect(() => applyPulledPage(SHOP, page({ products: [good, bad] }), '12')).toThrow(/invalid timestamp/);
    expect(getSyncValue('pull_cursor')).toBe('10');
    expect(getProduct(good.id)).toBeUndefined(); // Rolled back with the rest of the page.
  });
});

describe('pull', () => {
  it(`requests max(0, cursor − ${PULL_OVERLAP}) and pages until has_more is false`, async () => {
    expect(requestCursor(undefined)).toBeNull();
    expect(requestCursor('30')).toBe('0');
    expect(requestCursor('120')).toBe('70');

    setSyncValue('pull_cursor', '120');
    const responses: PullResponse[] = [
      {
        changes: page({ products: [product('7f6e5d4c-3b2a-4f1e-8d9c-8b7a69584736', 'A', 121)] }),
        next_cursor: '121',
        has_more: true,
      },
      {
        changes: page({ products: [product('8a7f6e5d-4c3b-4a2f-9e1d-9c8b7a695847', 'B', 122)] }),
        next_cursor: '122',
        has_more: false,
      },
    ];
    const calls: (string | null)[] = [];
    const api = {
      pull: jest.fn(async (_shop: string, cursor: string | null) => {
        calls.push(cursor);
        return responses.shift()!;
      }),
    } as unknown as ApiClient;

    const result = await pull(api, SHOP);

    expect(calls).toEqual(['70', '71']);
    expect(result).toEqual({ applied: 2, pages: 2, cursor: '122' });
    expect(getSyncValue('pull_cursor')).toBe('122');
  });
});
