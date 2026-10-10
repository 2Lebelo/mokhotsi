import type { DatabaseSync } from 'node:sqlite';

import type { PushRequest, PushResponse } from '@/contracts/sync';
import { needsAttention, peekBatch, pendingCount, retryRejected } from '@/db/repositories/outbox';
import { upsertProduct } from '@/db/repositories/products';
import { recordSale } from '@/db/repositories/sales';
import { NetworkError, type ApiClient } from '@/sync/apiClient';
import { push } from '@/sync/push';

import { resetTables } from './support/testDb';

jest.mock('@/db/client', () => require('./support/testDb').mockClientModule());

const client = (jest.requireMock('@/db/client') as { __client: DatabaseSync }).__client;
const SHOP = 'b0c4b7d8-6a0e-4c55-9b51-2f3c1a0e9d11';
const DEVICE = '7d0f6a8e-2b1c-4f3a-9e5d-1a2b3c4d5e6f';

function fakeApi(answer: (body: PushRequest) => PushResponse | Promise<PushResponse>) {
  const requests: PushRequest[] = [];
  const api = {
    push: jest.fn(async (_shop: string, body: PushRequest) => {
      requests.push(body);
      return answer(body);
    }),
  } as unknown as ApiClient;
  return { api, requests };
}

beforeEach(() => resetTables(client));

it('deletes acked rows and parks rejected ones under "needs attention"', async () => {
  const product = upsertProduct({ shopId: SHOP, name: 'Bread', priceCents: 1400, barcode: null });
  const { sale } = recordSale({
    shopId: SHOP,
    deviceId: DEVICE,
    lines: [{ productId: product.id, qty: 1, unitPriceCents: 1400, matchScore: null, matchMethod: 'manual' }],
  });
  const [productOp, saleOp] = peekBatch(10);

  const { api, requests } = fakeApi(() => ({
    acked: [saleOp!.opId],
    rejected: [{ op_id: productOp!.opId, reason: 'permission_denied: catalogue:write is required' }],
  }));
  const result = await push(api, SHOP, DEVICE);

  expect(requests).toHaveLength(1);
  expect(requests[0]!.device_id).toBe(DEVICE);
  expect(requests[0]!.ops.map((o) => o.entity)).toEqual(['products', 'sales']); // Oldest first.
  expect(requests[0]!.ops[1]!.entity_id).toBe(sale.id);
  expect(result).toEqual({ acked: 1, rejected: 1, remaining: false });
  expect(pendingCount()).toBe(1);
  expect(peekBatch(10)).toEqual([]); // The rejected op no longer blocks the queue.
  expect(needsAttention()).toMatchObject([
    { opId: productOp!.opId, rejectedReason: 'permission_denied: catalogue:write is required', attempts: 1 },
  ]);

  retryRejected([productOp!.opId]);
  expect(peekBatch(10).map((r) => r.opId)).toEqual([productOp!.opId]);
});

it('sends at most 200 ops per request and drains the outbox in batches', async () => {
  const product = upsertProduct({ shopId: SHOP, name: 'Bread', priceCents: 1400, barcode: null });
  for (let i = 0; i < 250; i++) {
    recordSale({
      shopId: SHOP,
      deviceId: DEVICE,
      lines: [
        { productId: product.id, qty: 1, unitPriceCents: 1400, matchScore: null, matchMethod: 'manual' },
      ],
    });
  }
  const { api, requests } = fakeApi((body) => ({ acked: body.ops.map((o) => o.op_id), rejected: [] }));

  const result = await push(api, SHOP, DEVICE);

  expect(requests.map((r) => r.ops.length)).toEqual([200, 51]);
  expect(result).toEqual({ acked: 251, rejected: 0, remaining: false });
  expect(pendingCount()).toBe(0);
});

it('keeps everything queued when the network fails', async () => {
  upsertProduct({ shopId: SHOP, name: 'Bread', priceCents: 1400, barcode: null });
  const { api } = fakeApi(() => {
    throw new NetworkError('offline');
  });
  await expect(push(api, SHOP, DEVICE)).rejects.toBeInstanceOf(NetworkError);
  expect(pendingCount()).toBe(1);
  expect(needsAttention()).toEqual([]);
});
