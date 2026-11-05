import type { SQLiteDatabase } from "expo-sqlite";

import type { StockMovementKind } from "../../contracts/sync.ts";
import type { OutboxRepository } from "./outbox.ts";
import type { StoreContext } from "./shared.ts";

type MoveOptions = {
  /** The sale or reversal behind a `sale` or `reversal` movement. */
  refId?: string;
  /** The op of that sale or reversal; the server derives the movement from it. */
  opId?: string | null;
  /** Only move if enough stock is left and the size is still sold (checkout). */
  requireStock?: boolean;
};

/**
 * The stock ledger. Every change to a size's stock is a movement; `product_variants.stock`
 * is kept as the running projection. Opening stock, restocks and adjustments are pushed as
 * their own ops, while sale and reversal movements ride on the op of their sale or reversal.
 * Call inside the transaction that causes the movement.
 */
export class StockLedger {
  private db: SQLiteDatabase;
  private context: StoreContext;
  private outbox: OutboxRepository;

  constructor(
    db: SQLiteDatabase,
    context: StoreContext,
    outbox: OutboxRepository,
  ) {
    this.db = db;
    this.context = context;
    this.outbox = outbox;
  }

  /** Returns false when `requireStock` is set and the stock or size no longer allows it. */
  move(
    variantId: string,
    delta: number,
    kind: StockMovementKind | "sale" | "reversal",
    { refId, opId = null, requireStock = false }: MoveOptions = {},
  ): boolean {
    if (!Number.isSafeInteger(delta))
      throw new Error("A stock change must be a whole number.");
    if (delta === 0) return true;
    const at = this.context.clock().toISOString();
    const updated = this.db.runSync(
      requireStock
        ? "UPDATE product_variants SET stock = stock + ?, updated_at = ? WHERE id = ? AND stock + ? >= 0 AND archived_at IS NULL"
        : "UPDATE product_variants SET stock = stock + ?, updated_at = ? WHERE id = ?",
      ...(requireStock
        ? [delta, at, variantId, delta]
        : [delta, at, variantId]),
    );
    if (updated.changes !== 1) {
      if (requireStock) return false;
      throw new Error("This size no longer exists.");
    }

    const id = this.context.newId();
    const { userId, deviceId } = this.context.actor;
    const movementOp: string | null =
      kind === "sale" || kind === "reversal"
        ? opId
        : this.outbox.record("stock_movements", id, {
            id,
            variant_id: variantId,
            delta,
            kind,
            actor_user_id: userId,
            device_id: deviceId,
            created_at: at,
          });
    this.insertMovement(id, variantId, delta, kind, refId ?? null, movementOp, at);
    return true;
  }

  private insertMovement(
    id: string,
    variantId: string,
    delta: number,
    kind: StockMovementKind | "sale" | "reversal",
    refId: string | null,
    opId: string | null,
    at: string,
  ): void {
    const { userId, deviceId } = this.context.actor;
    this.db.runSync(
      "INSERT INTO stock_movements (id, variant_id, delta, kind, ref_id, op_id, actor_user_id, device_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
      id,
      variantId,
      delta,
      kind,
      refId,
      opId,
      userId,
      deviceId,
      at,
    );
  }

  /**
   * Binding a shop that already has stock: the server starts from nothing, so each size's
   * current stock is sent as its opening movement. The figure on this phone does not change.
   */
  queueOpeningStock(): void {
    const at = this.context.clock().toISOString();
    const sizes = this.db.getAllSync<{ id: string; stock: number }>(
      "SELECT id, stock FROM product_variants WHERE archived_at IS NULL AND stock <> 0 ORDER BY product_id, position",
    );
    const { userId, deviceId } = this.context.actor;
    for (const size of sizes) {
      const id = this.context.newId();
      const opId = this.outbox.record("stock_movements", id, {
        id,
        variant_id: size.id,
        delta: size.stock,
        kind: "opening",
        actor_user_id: userId,
        device_id: deviceId,
        created_at: at,
      });
      this.insertMovement(id, size.id, size.stock, "opening", null, opId, at);
    }
    this.db.runSync("UPDATE product_variants SET server_stock = 0");
  }

  /** Stock as the server last reported it (pull); `rebase` then recomputes this phone's figure. */
  setServerStock(variantId: string, stock: number): void {
    this.db.runSync(
      "UPDATE product_variants SET server_stock = ? WHERE id = ?",
      stock,
      variantId,
    );
  }

  /**
   * After a pull up to `cursor`: each size's stock is the server's plus this phone's
   * movements the server has not counted yet. Those are the movements of ops still queued,
   * or acked after `cursor` (their effect is not in the pulled figure yet). A refused op's
   * movement drops out, since the server never applied it; movements from before the shop
   * was registered (no op) are already in the opening stock.
   */
  rebase(cursor: number): void {
    this.db.runSync(
      `UPDATE product_variants SET stock = server_stock + COALESCE((
         SELECT SUM(m.delta) FROM stock_movements m
         WHERE m.variant_id = product_variants.id AND m.op_id IS NOT NULL
           AND (m.op_id IN (SELECT op_id FROM outbox WHERE status = 'pending')
             OR m.op_id IN (SELECT op_id FROM acked_ops WHERE acked_seq > ?))), 0)`,
      cursor,
    );
    this.db.runSync("DELETE FROM acked_ops WHERE acked_seq <= ?", cursor);
  }
}
