import { useCallback } from 'react';

import {
  discardRejected,
  needsAttention,
  pendingCount,
  retryRejected,
  unsyncedSalesCount,
} from '@/db/repositories/outbox';
import { useLiveRead } from '@/features/data/useLiveRead';
import { attempt } from '@/lib/attempt';

import { useSync } from './useSync';

export interface AttentionItem {
  opId: string;
  /** e.g. "Sale", "Product". */
  label: string;
  reason: string;
}

export interface BackupStatus {
  /** Sales recorded on this phone that the server has not confirmed yet. */
  unsyncedSales: number;
  /** All local changes waiting to be pushed (sales, products, embeddings), rejected included. */
  pendingChanges: number;
  /** Changes the server refused; they wait for the user to retry or discard them. */
  needsAttention: AttentionItem[];
  error: string | null;
  retry(opIds: readonly string[]): void;
  discard(opIds: readonly string[]): void;
}

const LABELS = { sales: 'Sale', products: 'Product', embeddings: 'Product photo' } as const;

function read(): Omit<BackupStatus, 'retry' | 'discard'> {
  const result = attempt(() => ({
    unsyncedSales: unsyncedSalesCount(),
    pendingChanges: pendingCount(),
    needsAttention: needsAttention().map((row) => ({
      opId: row.opId,
      label: LABELS[row.entity],
      reason: row.rejectedReason ?? '',
    })),
  }));
  return result.ok
    ? { ...result.value, error: null }
    : { unsyncedSales: 0, pendingChanges: 0, needsAttention: [], error: result.error.message };
}

/** "Sales not yet backed up" and the "needs attention" list, refreshed on every outbox change. */
export function useBackupStatus(): BackupStatus {
  const status = useLiveRead(['outbox'], read, undefined);
  const sync = useSync();

  const retry = useCallback(
    (opIds: readonly string[]) => {
      retryRejected(opIds);
      sync.request('manual');
    },
    [sync],
  );
  const discard = useCallback((opIds: readonly string[]) => discardRejected(opIds), []);

  return { ...status, retry, discard };
}
