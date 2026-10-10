import { and, asc, count, eq, inArray, isNotNull, isNull, sql } from 'drizzle-orm';

import type { Entity, OpKind } from '@/contracts/sync';
import { newId, type Uuid } from '@/lib/ids';
import { db, type Tx } from '@/db/client';
import { notifyChanged } from '@/db/changes';
import { outbox, type OutboxRow } from '@/db/schema';

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
  const opId = newId();
  tx.insert(outbox)
    .values({
      opId,
      entity: op.entity,
      entityId: op.entityId,
      op: op.op,
      payload: JSON.stringify(op.payload),
      createdAt: Date.now(),
      attempts: 0,
    })
    .run();
  return opId;
}

/**
 * Oldest-first batch for push, skipping rows the server rejected. `limit` must not exceed
 * SYNC_LIMITS.pushBatchSize. Ties on created_at keep insertion order (rowid).
 */
export function peekBatch(limit: number): OutboxRow[] {
  return db
    .select()
    .from(outbox)
    .where(isNull(outbox.rejectedReason))
    .orderBy(asc(outbox.createdAt), sql`rowid`)
    .limit(limit)
    .all();
}

/** Delete rows the server acknowledged. */
export function removeAcked(opIds: readonly Uuid[]): void {
  if (opIds.length === 0) return;
  db.transaction((tx) => {
    tx.delete(outbox)
      .where(inArray(outbox.opId, [...opIds]))
      .run();
  });
  notifyChanged('outbox');
}

/** Count a failed attempt for ops that were sent but neither acked nor rejected. */
export function markAttempted(opIds: readonly Uuid[]): void {
  if (opIds.length === 0) return;
  db.update(outbox)
    .set({ attempts: sql`${outbox.attempts} + 1` })
    .where(inArray(outbox.opId, [...opIds]))
    .run();
}

/** Park ops the server rejected: they leave the push queue and show under "needs attention". */
export function markRejected(rejections: readonly { opId: Uuid; reason: string }[]): void {
  if (rejections.length === 0) return;
  const now = Date.now();
  db.transaction((tx) => {
    for (const r of rejections) {
      tx.update(outbox)
        .set({ rejectedReason: r.reason, rejectedAt: now, attempts: sql`${outbox.attempts} + 1` })
        .where(eq(outbox.opId, r.opId))
        .run();
    }
  });
  notifyChanged('outbox');
}

export function needsAttention(): OutboxRow[] {
  return db
    .select()
    .from(outbox)
    .where(isNotNull(outbox.rejectedReason))
    .orderBy(asc(outbox.createdAt), sql`rowid`)
    .all();
}

/** Put rejected ops back in the push queue (e.g. after the keeper granted a permission). */
export function retryRejected(opIds: readonly Uuid[]): void {
  if (opIds.length === 0) return;
  db.update(outbox)
    .set({ rejectedReason: null, rejectedAt: null })
    .where(inArray(outbox.opId, [...opIds]))
    .run();
  notifyChanged('outbox');
}

/** Drop rejected ops for good. The local row they describe is left as it is. */
export function discardRejected(opIds: readonly Uuid[]): void {
  if (opIds.length === 0) return;
  db.delete(outbox)
    .where(and(inArray(outbox.opId, [...opIds]), isNotNull(outbox.rejectedReason)))
    .run();
  notifyChanged('outbox');
}

/** Every row still in the outbox, rejected ones included. */
export function pendingCount(): number {
  return db.select({ n: count() }).from(outbox).get()?.n ?? 0;
}

/** Sales recorded on this phone that the server has not acknowledged yet. */
export function unsyncedSalesCount(): number {
  return db.select({ n: count() }).from(outbox).where(eq(outbox.entity, 'sales')).get()?.n ?? 0;
}

/**
 * Of `ids`, the ones with any outbox row for `entity` (pending or rejected). Pull skips them
 * so a server copy never overwrites a local change that has not been pushed yet.
 */
export function pendingEntityIds(tx: Tx, entity: Entity, ids: readonly Uuid[]): Set<Uuid> {
  if (ids.length === 0) return new Set();
  const rows = tx
    .selectDistinct({ id: outbox.entityId })
    .from(outbox)
    .where(and(eq(outbox.entity, entity), inArray(outbox.entityId, [...ids])))
    .all();
  return new Set(rows.map((r) => r.id));
}
