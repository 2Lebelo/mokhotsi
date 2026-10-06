import { notImplemented } from '@/lib/errors';

import type { ApiClient } from './apiClient';
import type { SyncStatus, SyncTrigger } from './types';

/**
 * Sync triggers:
 *  1. app start (once the user is signed in)              → 'app_start'
 *  2. network regained (expo-network addNetworkStateListener) → 'network_regained'
 *  3. 30 s after the last sale (debounced; resets on each sale) → 'after_sale'
 *  4. manual "Sync now" (debug screen / pull-to-refresh)    → 'manual'
 *  5. retry after failure: exponential backoff 30 s → 1 min → 2 min … capped at 15 min,
 *     reset to 30 s after a successful run                  → 'backoff_retry'
 * Only one run at a time; triggers arriving mid-run coalesce into one follow-up run.
 * Each run = push() then pull(). The checkout path never waits on the worker.
 */
export const SYNC_TIMING = {
  afterSaleDelayMs: 30_000,
  backoffInitialMs: 30_000,
  backoffMaxMs: 15 * 60_000,
} as const;

export interface SyncWorkerOptions {
  api: ApiClient;
  deviceId: string;
  onStatus: (status: SyncStatus) => void;
}

export interface SyncWorkerHandle {
  /** Ask for a run; coalesced if one is in flight. */
  request(trigger: SyncTrigger): void;
  /** Remove listeners and timers. */
  stop(): void;
}

export function startSyncWorker(options: SyncWorkerOptions): SyncWorkerHandle {
  // TODO(feature): wire the triggers above, run push() then pull(), report status via onStatus, apply backoff.
  return notImplemented(`sync.startSyncWorker (device ${options.deviceId})`);
}
