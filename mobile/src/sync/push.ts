import { recordMetric } from '@/db/repositories/metrics';
import { markAttempted, markRejected, peekBatch, removeAcked } from '@/db/repositories/outbox';
import { setSyncValue } from '@/db/repositories/syncState';
import { SYNC_LIMITS } from '@/lib/config';
import { createLogger } from '@/lib/logger';

import type { ApiClient } from './apiClient';
import { toOp } from './outbox';
import type { PushResult } from './types';

const log = createLogger('sync.push');

/**
 * Drain the outbox to the server in batches of SYNC_LIMITS.pushBatchSize (200), oldest first.
 *
 * Per batch: acked rows are deleted; rejected rows are parked with their reason (they leave the
 * queue and appear under "needs attention"); rows the server did not mention count an attempt.
 * op_id is the idempotency key, so re-sending after a crash or timeout is safe. A NetworkError
 * or HTTP error propagates so the worker can back off; rows stay queued.
 */
export async function push(api: ApiClient, shopId: string, deviceId: string): Promise<PushResult> {
  const started = Date.now();
  let acked = 0;
  let rejected = 0;
  let remaining = false;
  for (;;) {
    const batch = peekBatch(SYNC_LIMITS.pushBatchSize);
    if (batch.length === 0) break;
    const response = await api.push(shopId, { device_id: deviceId, ops: batch.map(toOp) });

    removeAcked(response.acked);
    markRejected(response.rejected.map((r) => ({ opId: r.op_id, reason: r.reason })));
    const answered = new Set([...response.acked, ...response.rejected.map((r) => r.op_id)]);
    const unanswered = batch.filter((row) => !answered.has(row.opId)).map((row) => row.opId);
    markAttempted(unanswered);
    acked += response.acked.length;
    rejected += response.rejected.length;

    if (unanswered.length > 0) {
      // Should not happen with a conforming server; stop rather than resend the same batch.
      log.warn('server left ops unanswered', { count: unanswered.length });
      remaining = true;
      break;
    }
    if (batch.length < SYNC_LIMITS.pushBatchSize) break;
    remaining = true; // A full batch: there may be more.
  }
  if (remaining) remaining = peekBatch(1).length > 0;
  setSyncValue('last_push_at', String(Date.now()));
  recordMetric('push_ms', Date.now() - started, { acked, rejected });
  if (acked + rejected > 0) log.info('pushed', { acked, rejected });
  return { acked, rejected, remaining };
}
