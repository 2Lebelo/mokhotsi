import { addNetworkStateListener, type NetworkStateEvent } from 'expo-network';

import { createLogger } from '@/lib/logger';

import { isSessionExpired, type ApiClient } from './apiClient';
import { pull as defaultPull } from './pull';
import { push as defaultPush } from './push';
import type { PullResult, PushResult, SyncStatus, SyncTrigger } from './types';

const log = createLogger('sync.worker');

/**
 * Sync triggers:
 *  1. app start (once the user is signed in to a shop)        → 'app_start'
 *  2. network regained (expo-network addNetworkStateListener) → 'network_regained'
 *  3. 30 s after the last sale (debounced; resets on each sale) → 'after_sale'
 *  4. manual "Sync now" (debug screen)                        → 'manual'
 *  5. retry after failure: exponential backoff 30 s → 1 min → 2 min … capped at 15 min,
 *     reset to 30 s after a successful run                    → 'backoff_retry'
 * Only one run at a time; triggers arriving mid-run coalesce into one follow-up run.
 * Each run = pull() then push(). The checkout path never waits on the worker.
 */
export const SYNC_TIMING = {
  afterSaleDelayMs: 30_000,
  backoffInitialMs: 30_000,
  backoffMaxMs: 15 * 60_000,
} as const;

export interface SyncWorkerOptions {
  api: ApiClient;
  shopId: string;
  deviceId: string;
  onStatus: (status: SyncStatus) => void;
  /** The refresh token was refused: the user must sign in again. */
  onSessionExpired?: () => void;
  /** Injected in tests. */
  runPull?: (api: ApiClient, shopId: string) => Promise<PullResult>;
  runPush?: (api: ApiClient, shopId: string, deviceId: string) => Promise<PushResult>;
  /** Calls `onRegained` when internet comes back; returns an unsubscribe function. */
  subscribeNetwork?: (onRegained: () => void) => () => void;
  now?: () => number;
}

export interface SyncWorkerHandle {
  /** Ask for a run; coalesced if one is in flight ('after_sale' is debounced). */
  request(trigger: SyncTrigger): void;
  /** Remove listeners and timers. */
  stop(): void;
}

/** Default network trigger: fire on an offline → online transition. */
export function subscribeToNetworkRegained(onRegained: () => void): () => void {
  let online: boolean | undefined;
  const subscription = addNetworkStateListener((event: NetworkStateEvent) => {
    const now = event.isInternetReachable ?? event.isConnected ?? false;
    if (online === false && now) onRegained();
    online = now;
  });
  return () => subscription.remove();
}

export function startSyncWorker(options: SyncWorkerOptions): SyncWorkerHandle {
  const runPull = options.runPull ?? defaultPull;
  const runPush = options.runPush ?? defaultPush;
  const now = options.now ?? Date.now;

  let stopped = false;
  let running = false;
  let followUp: SyncTrigger | null = null;
  let backoffMs: number = SYNC_TIMING.backoffInitialMs;
  let afterSaleTimer: ReturnType<typeof setTimeout> | null = null;
  let retryTimer: ReturnType<typeof setTimeout> | null = null;
  let lastSuccessAt: number | null = null;

  const clearRetry = () => {
    if (retryTimer !== null) clearTimeout(retryTimer);
    retryTimer = null;
  };

  async function run(trigger: SyncTrigger): Promise<void> {
    if (stopped) return;
    if (running) {
      followUp = trigger;
      return;
    }
    clearRetry();
    running = true;
    options.onStatus({ state: 'running', trigger });
    try {
      await runPull(options.api, options.shopId);
      await runPush(options.api, options.shopId, options.deviceId);
      backoffMs = SYNC_TIMING.backoffInitialMs;
      lastSuccessAt = now();
      if (!stopped) options.onStatus({ state: 'idle', lastSuccessAt });
    } catch (error) {
      if (stopped) return;
      if (isSessionExpired(error)) {
        stopped = true;
        options.onStatus({ state: 'disabled', reason: 'Session expired: sign in again' });
        options.onSessionExpired?.();
        return;
      }
      const message = error instanceof Error ? error.message : String(error);
      const delay = backoffMs;
      backoffMs = Math.min(backoffMs * 2, SYNC_TIMING.backoffMaxMs);
      retryTimer = setTimeout(() => void run('backoff_retry'), delay);
      log.warn('sync failed; retrying later', { trigger, delayMs: delay, error: message });
      options.onStatus({ state: 'backoff', retryAt: now() + delay, error: message });
    } finally {
      running = false;
      if (followUp !== null && !stopped) {
        const next = followUp;
        followUp = null;
        void run(next);
      }
    }
  }

  let unsubscribeNetwork: () => void = () => undefined;
  try {
    unsubscribeNetwork = (options.subscribeNetwork ?? subscribeToNetworkRegained)(() =>
      handle.request('network_regained'),
    );
  } catch (error) {
    // Without the listener the other triggers (app start, sales, manual, backoff) still sync.
    log.warn('network listener unavailable', { error: String(error) });
  }

  const handle: SyncWorkerHandle = {
    request(trigger) {
      if (stopped) return;
      if (trigger === 'after_sale') {
        if (afterSaleTimer !== null) clearTimeout(afterSaleTimer);
        afterSaleTimer = setTimeout(() => {
          afterSaleTimer = null;
          void run('after_sale');
        }, SYNC_TIMING.afterSaleDelayMs);
        return;
      }
      void run(trigger);
    },
    stop() {
      stopped = true;
      if (afterSaleTimer !== null) clearTimeout(afterSaleTimer);
      clearRetry();
      unsubscribeNetwork();
    },
  };
  return handle;
}
