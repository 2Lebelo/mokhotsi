import { createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';

import { getSyncValue } from '@/db/repositories/syncState';
import { getConfig } from '@/lib/config';
import { createLogger } from '@/lib/logger';
import { createApiClient } from '@/sync/apiClient';
import type { SyncStatus, SyncTrigger } from '@/sync/types';
import { startSyncWorker, type SyncWorkerHandle } from '@/sync/worker';

import { AuthContext } from './AuthProvider';

const log = createLogger('sync');

export interface SyncContextValue {
  status: SyncStatus;
  request(trigger: SyncTrigger): void;
}

export const SyncContext = createContext<SyncContextValue | null>(null);

/** Starts the background sync worker once signed in. Failures never block the UI. */
export function SyncProvider({ children }: { children: ReactNode }) {
  const auth = useContext(AuthContext);
  const [workerStatus, setWorkerStatus] = useState<SyncStatus | null>(null);
  const worker = useRef<SyncWorkerHandle | null>(null);
  const session = auth?.state.status === 'signed_in' ? auth.state.session : null;

  useEffect(() => {
    if (!session || session.dev) return;
    let cancelled = false;
    // Start asynchronously so startup never blocks the first render.
    Promise.resolve()
      .then(() => {
        const api = createApiClient({
          baseUrl: getConfig().apiUrl,
          getAccessToken: async () => session.accessToken,
        });
        const deviceId = getSyncValue('device_id') ?? '';
        return startSyncWorker({ api, deviceId, onStatus: setWorkerStatus });
      })
      .then(
        (handle) => {
          if (cancelled) return handle.stop();
          worker.current = handle;
          handle.request('app_start');
        },
        (error: unknown) => {
          const reason = error instanceof Error ? error.message : String(error);
          log.error('sync worker failed to start', { reason });
          if (!cancelled) setWorkerStatus({ state: 'disabled', reason });
        },
      );
    return () => {
      cancelled = true;
      worker.current?.stop();
      worker.current = null;
    };
  }, [session]);

  const value = useMemo<SyncContextValue>(
    () => ({
      status: !session
        ? { state: 'disabled', reason: 'signed out' }
        : session.dev
          ? { state: 'disabled', reason: 'dev bypass session (no backend)' }
          : (workerStatus ?? { state: 'disabled', reason: 'starting' }),
      request: (trigger) => {
        if (worker.current) worker.current.request(trigger);
        else log.warn('sync requested but worker is not running', { trigger });
      },
    }),
    [session, workerStatus],
  );
  return <SyncContext.Provider value={value}>{children}</SyncContext.Provider>;
}
