import { useNetworkState } from 'expo-network';
import { useEffect, useMemo, useState } from 'react';
import { isResizerAvailable } from 'react-native-vision-camera-resizer';

import { subscribe } from '@/db/changes';
import { getSyncValue } from '@/db/repositories/syncState';
import { useCurrentShop } from '@/features/auth/useAuth';
import { useDetector, type DetectorState } from '@/features/checkout/useDetector';
import { useModelStatus } from '@/features/checkout/useModelStatus';
import { useSync } from '@/features/sync/useSync';
import { attempt } from '@/lib/attempt';
import { getConfig } from '@/lib/config';

export interface DebugRow {
  label: string;
  value: string;
}

function describeDetector(d: DetectorState): string {
  switch (d.state) {
    case 'ready': {
      const shape = (t: { shape: number[] } | undefined) => `[${t?.shape.join(', ') ?? '?'}]`;
      return (
        `${d.spec.model_version} · ${d.model.delegates.join('+') || 'CPU'} · ` +
        `in ${shape(d.model.inputs[0])} out ${shape(d.model.outputs[0])}`
      );
    }
    case 'loading':
      return 'loading…';
    default:
      return `⚠ ${d.message}`;
  }
}

function formatTime(ms: string | undefined): string {
  return ms ? new Date(Number(ms)).toLocaleString() : 'never';
}

/** Diagnostics for the debug tab: config, shop, models, GPU resizer, network, sync state. */
export function useDebugInfo(): { rows: DebugRow[]; syncNow: () => void } {
  const models = useModelStatus();
  const detector = useDetector();
  const network = useNetworkState();
  const sync = useSync();
  const shop = useCurrentShop();
  const [syncVersion, setSyncVersion] = useState(0);

  useEffect(() => subscribe(['sync_state'], () => setSyncVersion((v) => v + 1)), []);

  const rows = useMemo<DebugRow[]>(() => {
    const show = <T>(fn: () => T) => {
      const r = attempt(fn);
      return r.ok ? String(r.value) : `⚠ ${r.error.message}`;
    };
    return [
      { label: 'API URL', value: show(() => getConfig().apiUrl) },
      { label: 'Shop', value: shop ? `${shop.shopName} (${shop.email})` : 'none' },
      { label: 'Device id', value: show(() => getSyncValue('device_id') ?? 'not created yet') },
      {
        label: 'Models',
        value:
          models.state === 'ready' ? `ready (${models.manifest.embedder.model_version})` : models.message,
      },
      { label: 'Detector', value: describeDetector(detector) },
      { label: 'GPU resizer', value: show(() => (isResizerAvailable() ? 'available' : 'NOT available')) },
      {
        label: 'Network',
        value: `${network.type ?? 'unknown'} · internet ${String(network.isInternetReachable ?? 'unknown')}`,
      },
      { label: 'Sync', value: JSON.stringify(sync.status) },
      { label: 'Pull cursor (seq)', value: show(() => getSyncValue('pull_cursor') ?? 'none') },
      { label: 'Last pull', value: show(() => formatTime(getSyncValue('last_pull_at'))) },
      { label: 'Last push', value: show(() => formatTime(getSyncValue('last_push_at'))) },
    ];
    // syncVersion re-reads sync_state after each pull/push.
  }, [models, detector, network, sync.status, shop, syncVersion]); // eslint-disable-line react-hooks/exhaustive-deps

  return { rows, syncNow: () => sync.request('manual') };
}
