import type { PullChanges } from '@/contracts/sync';
import { notImplemented } from '@/lib/errors';

/** Keys stored in the sync_state table. */
export type SyncStateKey = 'device_id' | 'shop_id' | 'pull_cursor' | 'last_push_at' | 'last_pull_at';

export function getSyncValue(key: SyncStateKey): string | undefined {
  // TODO(feature): select value from sync_state where key = ?.
  return notImplemented('syncState.getSyncValue');
}

export function setSyncValue(key: SyncStateKey, value: string): void {
  // TODO(feature): insert … on conflict(key) do update set value = excluded.value.
  return notImplemented('syncState.setSyncValue');
}

/**
 * Apply one pulled page AND store its cursor in a single transaction, so a crash can never
 * advance the cursor without the data (or vice versa). Remote changes must not create outbox rows.
 */
export function applyPulledPage(changes: PullChanges, nextCursor: string): void {
  // TODO(feature): one transaction: upsert products/embeddings/sales(+items) by id, honour `deleted`, set pull_cursor.
  return notImplemented('syncState.applyPulledPage');
}
