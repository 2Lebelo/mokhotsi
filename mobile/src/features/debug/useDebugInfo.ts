import { useNetworkState } from 'expo-network';
import { useMemo } from 'react';
import { isResizerAvailable } from 'react-native-vision-camera-resizer';

import { pendingCount } from '@/db/repositories/outbox';
import { useModelStatus } from '@/features/checkout/useModelStatus';
import { useSync } from '@/features/sync/useSync';
import { attempt } from '@/lib/attempt';
import { getConfig } from '@/lib/config';

export interface DebugRow {
  label: string;
  value: string;
}

/** Diagnostics for the debug tab: config, models, GPU resizer, network, sync, outbox. */
export function useDebugInfo(): { rows: DebugRow[]; syncNow: () => void } {
  const models = useModelStatus();
  const network = useNetworkState();
  const sync = useSync();

  const rows = useMemo<DebugRow[]>(() => {
    const show = <T>(fn: () => T) => {
      const r = attempt(fn);
      return r.ok ? String(r.value) : `⚠ ${r.error.message}`;
    };
    return [
      { label: 'API URL', value: show(() => getConfig().apiUrl) },
      {
        label: 'Models',
        value:
          models.state === 'ready' ? `ready (${models.manifest.embedder.model_version})` : models.message,
      },
      { label: 'GPU resizer', value: show(() => (isResizerAvailable() ? 'available' : 'NOT available')) },
      {
        label: 'Network',
        value: `${network.type ?? 'unknown'} · internet ${String(network.isInternetReachable ?? 'unknown')}`,
      },
      { label: 'Sync', value: JSON.stringify(sync.status) },
      { label: 'Outbox pending', value: show(() => pendingCount()) },
    ];
  }, [models, network, sync.status]);

  return { rows, syncNow: () => sync.request('manual') };
}
