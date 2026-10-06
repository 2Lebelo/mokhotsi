import { notImplemented } from '@/lib/errors';

import type { ApiClient } from './apiClient';
import type { PullResult } from './types';

/**
 * Fetch server changes after the stored cursor, SYNC_LIMITS.pullPageSize (500) per page.
 *
 * Intended flow: cursor = syncState.getSyncValue('pull_cursor') → api.pull(cursor, 500)
 * → syncState.applyPulledPage(changes, next_cursor) (one transaction) → repeat while has_more.
 * Order comes from the server's per-shop `seq`, never the device clock.
 */
export async function pull(api: ApiClient): Promise<PullResult> {
  // TODO(feature): implement the paging loop above; after applying embeddings, rebuild the VectorIndex.
  return notImplemented(`sync.pull (api ${typeof api.pull})`);
}
