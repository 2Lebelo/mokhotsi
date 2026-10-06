import { notImplemented } from '@/lib/errors';

import type { ApiClient } from './apiClient';
import type { PushResult } from './types';

/**
 * Drain the outbox to POST /sync/push in batches of SYNC_LIMITS.pushBatchSize (200).
 *
 * Intended flow per batch: outbox.peekBatch(200) → toOp() → api.push({ device_id, ops })
 * → outbox.removeAcked(acked) → outbox.markAttempted(rejected) → repeat while a full batch was
 * sent. op_id is the idempotency key, so re-sending after a crash is safe.
 */
export async function push(api: ApiClient, deviceId: string): Promise<PushResult> {
  // TODO(feature): implement the batch loop above; stop on NetworkError and let the worker back off.
  return notImplemented(`sync.push (device ${deviceId}, api ${typeof api.push})`);
}
