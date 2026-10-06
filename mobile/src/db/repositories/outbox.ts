import type { Entity, OpKind } from '@/contracts/sync';
import type { Uuid } from '@/lib/ids';
import { notImplemented } from '@/lib/errors';
import type { Tx } from '@/db/client';
import type { OutboxRow } from '@/db/schema';

export interface EnqueueOp {
  entity: Entity;
  entityId: Uuid;
  op: OpKind;
  /** Serialisable payload shaped per contracts/sync.schema.json (`Op.payload`). */
  payload: Record<string, unknown>;
}

/**
 * Insert one outbox row inside the caller's transaction. Every entity repository calls this
 * from the same `db.transaction((tx) => …)` that writes the entity, so the two commit together.
 */
export function enqueue(tx: Tx, op: EnqueueOp): Uuid {
  // TODO(feature): insert { opId: newId(), …op, payload: JSON.stringify(op.payload), createdAt: Date.now(), attempts: 0 } via tx.insert(outbox).values(…).run().
  return notImplemented('outbox.enqueue');
}

/** Oldest-first batch for POST /sync/push; `limit` must not exceed SYNC_LIMITS.pushBatchSize. */
export function peekBatch(limit: number): OutboxRow[] {
  // TODO(feature): select from outbox order by created_at asc limit ? (uses outbox_created_idx).
  return notImplemented('outbox.peekBatch');
}

/** Delete rows the server acknowledged (acked op_ids). */
export function removeAcked(opIds: readonly Uuid[]): void {
  // TODO(feature): delete from outbox where op_id in (?) in one transaction.
  return notImplemented('outbox.removeAcked');
}

/** Increment `attempts` for ops that failed or were rejected; caller decides on dead-lettering. */
export function markAttempted(opIds: readonly Uuid[]): void {
  // TODO(feature): update outbox set attempts = attempts + 1 where op_id in (?).
  return notImplemented('outbox.markAttempted');
}

export function pendingCount(): number {
  // TODO(feature): select count(*) from outbox.
  return notImplemented('outbox.pendingCount');
}
