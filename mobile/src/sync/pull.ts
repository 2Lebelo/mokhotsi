import { recordMetric } from '@/db/repositories/metrics';
import { applyPulledPage, getSyncValue } from '@/db/repositories/syncState';
import { SYNC_LIMITS } from '@/lib/config';
import { createLogger } from '@/lib/logger';

import type { ApiClient } from './apiClient';
import type { PullResult } from './types';

const log = createLogger('sync.pull');

/**
 * Re-read this many seqs before the stored cursor on every pull. Applying a page is idempotent
 * (upsert by id, insert-only sales), so the overlap costs little and covers a cursor that was
 * saved just before a crash or a server-side seq gap.
 */
export const PULL_OVERLAP = 50;

/** The cursor to request: max(0, stored − PULL_OVERLAP), or null on first sync. */
export function requestCursor(stored: string | undefined): string | null {
  if (stored === undefined) return null;
  const seq = Number(stored);
  if (!Number.isSafeInteger(seq) || seq < 0) return null; // Corrupt value: start over.
  return String(Math.max(0, seq - PULL_OVERLAP));
}

/**
 * Fetch every server change after the stored cursor, SYNC_LIMITS.pullPageSize (500) per page.
 * Each page is applied together with its next_cursor in ONE transaction (applyPulledPage), so
 * the cursor is saved only after the whole page applied. Order comes from the server's `seq`.
 */
export async function pull(api: ApiClient, shopId: string): Promise<PullResult> {
  const started = Date.now();
  let applied = 0;
  let pages = 0;
  let previous = -1;
  for (;;) {
    const cursor = requestCursor(getSyncValue('pull_cursor'));
    const response = await api.pull(shopId, cursor, SYNC_LIMITS.pullPageSize);
    const result = applyPulledPage(shopId, response.changes, response.next_cursor);
    applied += result.applied;
    pages++;
    const next = Number(response.next_cursor);
    // Stop on the last page, or if the server stops advancing (never loop forever).
    if (!response.has_more || next <= previous) break;
    previous = next;
  }
  const cursor = getSyncValue('pull_cursor') ?? null;
  recordMetric('pull_ms', Date.now() - started, { applied, pages });
  log.info('pulled', { applied, pages, cursor });
  return { applied, pages, cursor };
}
