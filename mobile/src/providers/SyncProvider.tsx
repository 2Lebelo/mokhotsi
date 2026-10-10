import { createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';

import { getOrCreateDeviceId } from '@/db/repositories/syncState';
import { createLogger } from '@/lib/logger';
import type { SyncStatus, SyncTrigger } from '@/sync/types';
import { startSyncWorker, type SyncWorkerHandle } from '@/sync/worker';

import { AuthContext } from './AuthProvider';

const log = createLogger('sync');

export interface SyncContextValue {
  status: SyncStatus;
  request(trigger: SyncTrigger): void;
}

export const SyncContext = createContext<SyncContextValue | null>(null);

/** Runs the background sync worker while signed in to a shop. Failures never block the UI. */
export function SyncProvider({ children }: { children: ReactNode }) {
  const auth = useContext(AuthContext);
  const [workerStatus, setWorkerStatus] = useState<SyncStatus | null>(null);
  const worker = useRef<SyncWorkerHandle | null>(null);
  const session = auth?.state.status === 'signed_in' ? auth.state.session : null;
  const api = auth?.api ?? null;
  const expire = auth?.expire;
  const shopId = session && !session.dev ? session.shopId : null;

  useEffect(() => {
    if (!shopId || !api) return;
    const handle = startSyncWorker({
      api,
      shopId,
      deviceId: getOrCreateDeviceId(),
      onStatus: setWorkerStatus,
      onSessionExpired: expire,
    });
    worker.current = handle;
    handle.request('app_start');
    return () => {
      handle.stop();
      worker.current = null;
      setWorkerStatus(null);
    };
  }, [shopId, api, expire]);

  const value = useMemo<SyncContextValue>(
    () => ({
      status: !session
        ? { state: 'disabled', reason: 'signed out' }
        : session.dev
          ? { state: 'disabled', reason: 'dev bypass session (no backend)' }
          : (workerStatus ?? { state: 'disabled', reason: 'starting' }),
      request: (trigger) => {
        if (worker.current) worker.current.request(trigger);
        else log.debug('sync requested but worker is not running', { trigger });
      },
    }),
    [session, workerStatus],
  );
  return <SyncContext.Provider value={value}>{children}</SyncContext.Provider>;
}
