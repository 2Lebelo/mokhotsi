import type { SQLiteDatabase } from "expo-sqlite";

import {
  UPSERT_ENTITIES,
  type OpPayload,
  type SyncEntity,
} from "../../contracts/sync.ts";
import type { OutboxOp } from "../types.ts";
import type { StoreContext } from "./shared.ts";

/** A batch stops here even below its op limit, so one push stays well under the server's 2 MB. */
const BATCH_BYTES = 512_000;

/**
 * The queue of local changes still to be sent to the server. `record` must be called inside
 * the transaction that makes the change, so a change and its op commit or roll back together.
 * Until the shop is bound to a server nothing is queued.
 */
export class OutboxRepository {
  private db: SQLiteDatabase;
  private context: StoreContext;

  constructor(db: SQLiteDatabase, context: StoreContext) {
    this.db = db;
    this.context = context;
  }

  isBound(): boolean {
    return (
      this.db.getFirstSync<{ value: string }>(
        "SELECT value FROM sync_state WHERE key = 'mode'",
      )?.value === "bound"
    );
  }

  /**
   * Queues a change and returns its op id, or null while the shop is not bound. For an
   * upsert entity a pending op for the same record is replaced by the latest state, under a
   * new op id, in its original place in the queue: a sale that refers to the product still
   * follows it, and an earlier op already in flight is acknowledged without being resent.
   */
  record<E extends SyncEntity>(
    entity: E,
    entityId: string,
    payload: OpPayload[E],
  ): string | null {
    if (!this.isBound()) return null;
    const opId = this.context.newId();
    const json = JSON.stringify(payload);
    if (UPSERT_ENTITIES.includes(entity)) {
      const replaced = this.db.runSync(
        "UPDATE outbox SET op_id = ?, payload = ? WHERE entity = ? AND entity_id = ? AND status = 'pending'",
        opId,
        json,
        entity,
        entityId,
      );
      if (replaced.changes) return opId;
    }
    this.insert(opId, entity, entityId, "upsert", json);
    return opId;
  }

  /** Queues the deletion of a stored view (the only entity that is deleted). */
  recordDelete(entity: "embeddings", entityId: string): string | null {
    if (!this.isBound()) return null;
    const opId = this.context.newId();
    this.insert(opId, entity, entityId, "delete", JSON.stringify({ id: entityId }));
    return opId;
  }

  private insert(
    opId: string,
    entity: SyncEntity,
    entityId: string,
    op: "upsert" | "delete",
    json: string,
  ): void {
    this.db.runSync(
      "INSERT INTO outbox (op_id, entity, entity_id, op, payload, created_at) VALUES (?, ?, ?, ?, ?, ?)",
      opId,
      entity,
      entityId,
      op,
      json,
      this.context.clock().toISOString(),
    );
  }

  /** The oldest pending ops, in the order they must reach the server. */
  pending(limit = 200): OutboxOp[] {
    return this.db
      .getAllSync<Omit<OutboxOp, "payload"> & { payload: string }>(
        "SELECT seq, op_id, entity, entity_id, op, payload, created_at FROM outbox WHERE status = 'pending' ORDER BY seq LIMIT ?",
        limit,
      )
      .map((row) => ({ ...row, payload: JSON.parse(row.payload) }));
  }

  /** The next push: up to `limit` pending ops in order, cut off at about 512 KB. */
  batch(limit: number): OutboxOp[] {
    const ops: OutboxOp[] = [];
    let bytes = 0;
    for (const row of this.db.getEachSync<Omit<OutboxOp, "payload"> & { payload: string }>(
      "SELECT seq, op_id, entity, entity_id, op, payload, created_at FROM outbox WHERE status = 'pending' ORDER BY seq LIMIT ?",
      limit,
    )) {
      bytes += row.payload.length;
      if (ops.length > 0 && bytes > BATCH_BYTES) break;
      ops.push({ ...row, payload: JSON.parse(row.payload) });
    }
    return ops;
  }

  /**
   * The server accepted these ops (`seq`: its latest seq after them). They leave the queue;
   * their stock stays counted until a pull reaches `seq` (see StockLedger.rebase).
   */
  ack(opIds: readonly string[], seq: number): void {
    for (const opId of opIds) {
      this.db.runSync("DELETE FROM outbox WHERE op_id = ?", opId);
      this.db.runSync(
        "INSERT OR REPLACE INTO acked_ops (op_id, acked_seq) VALUES (?, ?)",
        opId,
        seq,
      );
    }
  }

  /** The server will never accept this op as sent: it is parked, and no longer blocks others. */
  reject(opId: string, reason: string): void {
    this.db.runSync(
      "UPDATE outbox SET status = 'rejected', reason = ? WHERE op_id = ?",
      reason,
      opId,
    );
  }

  /** The op with this id, pending or parked (for describing an issue). */
  find(opId: string): Pick<OutboxOp, "op_id" | "entity" | "entity_id"> | null {
    return this.db.getFirstSync(
      "SELECT op_id, entity, entity_id FROM outbox WHERE op_id = ?",
      opId,
    );
  }

  /** Whether a record has a change still to send (pull must not overwrite it). */
  hasPending(entity: SyncEntity, entityId: string): boolean {
    return (
      this.db.getFirstSync(
        "SELECT 1 FROM outbox WHERE entity = ? AND entity_id = ? AND status = 'pending'",
        entity,
        entityId,
      ) !== null
    );
  }

  /** Changes not yet accepted by the server, for the sync status. */
  pendingCount(): number {
    return (
      this.db.getFirstSync<{ count: number }>(
        "SELECT COUNT(*) AS count FROM outbox WHERE status = 'pending'",
      )?.count ?? 0
    );
  }
}
