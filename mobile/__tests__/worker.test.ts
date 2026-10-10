import { ApiError, NetworkError, type ApiClient } from '@/sync/apiClient';
import type { SyncStatus } from '@/sync/types';
import { startSyncWorker, SYNC_TIMING, type SyncWorkerOptions } from '@/sync/worker';

// The worker's default pull/push import the database; these tests inject fakes instead.
jest.mock('@/db/client', () => require('./support/testDb').mockClientModule());
jest.mock('expo-network', () => ({ addNetworkStateListener: jest.fn(() => ({ remove: jest.fn() })) }));

const api = {} as ApiClient;

function setup(overrides: Partial<SyncWorkerOptions> = {}) {
  const order: string[] = [];
  const statuses: SyncStatus[] = [];
  let regained: () => void = () => undefined;
  const runPull = jest.fn(async () => {
    order.push('pull');
    return { applied: 0, pages: 1, cursor: '0' };
  });
  const runPush = jest.fn(async () => {
    order.push('push');
    return { acked: 0, rejected: 0, remaining: false };
  });
  const worker = startSyncWorker({
    api,
    shopId: 'shop',
    deviceId: 'device',
    onStatus: (s) => statuses.push(s),
    runPull,
    runPush,
    subscribeNetwork: (onRegained) => {
      regained = onRegained;
      return () => undefined;
    },
    ...overrides,
  });
  return { worker, order, statuses, runPull, runPush, regained: () => regained() };
}

/** Let pending promise callbacks run (the worker awaits pull and push). */
async function flush(): Promise<void> {
  for (let i = 0; i < 10; i++) await Promise.resolve();
}

beforeEach(() => jest.useFakeTimers());
afterEach(() => jest.useRealTimers());

it('pulls first, then pushes', async () => {
  const { worker, order, statuses } = setup();
  worker.request('app_start');
  await flush();
  expect(order).toEqual(['pull', 'push']);
  expect(statuses[0]).toEqual({ state: 'running', trigger: 'app_start' });
  expect(statuses.at(-1)).toMatchObject({ state: 'idle' });
  worker.stop();
});

it('runs 30 s after the LAST sale (debounced)', async () => {
  const { worker, runPull } = setup();
  worker.request('after_sale');
  jest.advanceTimersByTime(20_000);
  worker.request('after_sale'); // Resets the timer.
  jest.advanceTimersByTime(SYNC_TIMING.afterSaleDelayMs - 1);
  await flush();
  expect(runPull).not.toHaveBeenCalled();
  jest.advanceTimersByTime(1);
  await flush();
  expect(runPull).toHaveBeenCalledTimes(1);
  worker.stop();
});

it('syncs when the network comes back', async () => {
  const { worker, runPull, regained } = setup();
  regained();
  await flush();
  expect(runPull).toHaveBeenCalledTimes(1);
  worker.stop();
});

it('coalesces requests that arrive mid-run into one follow-up run', async () => {
  let release: () => void = () => undefined;
  const runPull = jest.fn(
    () =>
      new Promise<{ applied: number; pages: number; cursor: string }>((resolve) => {
        release = () => resolve({ applied: 0, pages: 1, cursor: '0' });
      }),
  );
  const { worker } = setup({ runPull });
  worker.request('app_start');
  worker.request('manual');
  worker.request('manual');
  release();
  await flush();
  release();
  await flush();
  expect(runPull).toHaveBeenCalledTimes(2);
  worker.stop();
});

it('backs off exponentially from 30 s to 15 min and resets after a success', async () => {
  let failures = 6;
  const runPull = jest.fn(async () => {
    if (failures-- > 0) throw new NetworkError('offline');
    return { applied: 0, pages: 1, cursor: '0' };
  });
  const { worker, statuses } = setup({ runPull, now: () => 0 });

  worker.request('app_start');
  await flush();
  const delays: number[] = [];
  for (let i = 0; i < 6; i++) {
    const last = statuses.at(-1);
    if (last?.state !== 'backoff') break;
    delays.push(last.retryAt);
    jest.advanceTimersByTime(last.retryAt);
    await flush();
  }
  expect(delays).toEqual([30_000, 60_000, 120_000, 240_000, 480_000, 900_000]);
  expect(statuses.at(-1)).toMatchObject({ state: 'idle' });

  // After a success the next failure starts again at 30 s.
  failures = 1;
  worker.request('manual');
  await flush();
  expect(statuses.at(-1)).toMatchObject({ state: 'backoff', retryAt: 30_000 });
  worker.stop();
});

it('stops and reports when the session has expired', async () => {
  const onSessionExpired = jest.fn();
  const runPull = jest.fn(async () => {
    throw new ApiError(401, { error: { code: 'session_revoked', message: 'Session expired or revoked' } });
  });
  const { worker, statuses } = setup({ runPull, onSessionExpired });
  worker.request('app_start');
  await flush();
  expect(onSessionExpired).toHaveBeenCalledTimes(1);
  expect(statuses.at(-1)).toMatchObject({ state: 'disabled' });
  worker.request('manual');
  await flush();
  expect(runPull).toHaveBeenCalledTimes(1);
});
