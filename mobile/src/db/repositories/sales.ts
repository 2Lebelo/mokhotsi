import type { SQLiteDatabase } from "expo-sqlite";

import { periodRange, sameLocalDay } from "../../domain/periods.ts";
import { variantLabel } from "../../domain/units.ts";
import type {
  Dashboard,
  ReversalLineInput,
  Sale,
  SaleItem,
  SaleReversal,
} from "../types.ts";
import type {
  ReversalItemPayload,
  ReversalPayload,
  SaleItemPayload,
  SalePayload,
} from "../../contracts/sync.ts";
import { cartTotal, type CartRepository } from "./cart.ts";
import type { OutboxRepository } from "./outbox.ts";
import { nonNegativeInteger, type StoreContext } from "./shared.ts";
import type { StockLedger } from "./stock.ts";

export class SalesRepository {
  private db: SQLiteDatabase;
  private context: StoreContext;
  private cart: CartRepository;
  private outbox: OutboxRepository;
  private stock: StockLedger;

  constructor(
    db: SQLiteDatabase,
    context: StoreContext,
    cart: CartRepository,
    outbox: OutboxRepository,
    stock: StockLedger,
  ) {
    this.db = db;
    this.context = context;
    this.cart = cart;
    this.outbox = outbox;
    this.stock = stock;
  }

  /**
   * Records the cart as a sale paid in cash. Repeating a sale id never records a
   * second sale. `tenderedCents` is the cash handed over (exact cash if omitted);
   * the change is stored with the sale for its receipt. Each line keeps the
   * size's cost at the time of sale, so later cost edits never rewrite profit.
   */
  checkout(
    saleId: string,
    tenderedCents?: number,
    now = this.context.clock(),
  ): string {
    if (!saleId.trim()) throw new Error("A sale reference is required.");
    if (tenderedCents !== undefined)
      nonNegativeInteger(tenderedCents, "Cash received");
    this.db.withTransactionSync(() => {
      if (this.db.getFirstSync("SELECT id FROM sales WHERE id = ?", saleId))
        return;
      const items = this.cart.items();
      if (!items.length)
        throw new Error("Add at least one product to the cart.");
      const total = cartTotal(items);
      const tendered = tenderedCents ?? total;
      if (tendered < total)
        throw new Error(
          "Cash received is less than the total. Enter the full amount.",
        );
      const at = now.toISOString();
      for (const item of items) {
        const name = `${item.product_name} · ${variantLabel(item)}`;
        if (item.archived_at)
          throw new Error(
            `${name} is no longer sold. Remove it from the cart.`,
          );
        if (item.quantity > item.stock)
          throw new Error(
            `Not enough stock for ${name}. Available: ${item.stock}. Update the cart or stock.`,
          );
      }
      const { userId, deviceId } = this.context.actor;
      this.db.runSync(
        "INSERT INTO sales (id, total_cents, tendered_cents, change_cents, actor_user_id, device_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
        saleId,
        total,
        tendered,
        tendered - total,
        userId,
        deviceId,
        at,
      );
      const lines: SaleItemPayload[] = items.map((item) => ({
        id: this.context.newId(),
        product_id: item.product_id,
        variant_id: item.id,
        product_name: item.product_name,
        variant_label: variantLabel(item),
        category: item.category,
        barcode: item.barcode,
        quantity: item.quantity,
        unit_price_cents: item.price_cents,
        line_total_cents: item.price_cents * item.quantity,
        unit_cost_cents: item.cost_cents ?? null,
      }));
      for (const line of lines)
        this.db.runSync(
          "INSERT INTO sale_items (id, sale_id, product_id, variant_id, product_name, variant_label, category, barcode, quantity, unit_price_cents, line_total_cents, unit_cost_cents) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
          line.id,
          saleId,
          line.product_id,
          line.variant_id,
          line.product_name,
          line.variant_label,
          line.category,
          line.barcode,
          line.quantity,
          line.unit_price_cents,
          line.line_total_cents,
          line.unit_cost_cents,
        );
      const opId = this.outbox.record("sales", saleId, {
        id: saleId,
        total_cents: total,
        tendered_cents: tendered,
        change_cents: tendered - total,
        actor_user_id: userId,
        device_id: deviceId,
        imported: false,
        created_at: at,
        items: lines,
      });
      for (const line of lines) {
        const moved = this.stock.move(line.variant_id, -line.quantity, "sale", {
          refId: saleId,
          opId,
          requireStock: true,
        });
        if (!moved)
          throw new Error(
            `Stock changed for ${line.product_name}. Please review the cart.`,
          );
      }
      this.db.runSync("DELETE FROM cart_items");
    });
    return saleId;
  }

  /**
   * Refunds some or all of a sale in cash. The sale itself is never edited: the
   * reversal is recorded alongside it, and each line chooses whether its units go
   * back on the shelf (restock) or are written off as damaged. Only sales from the
   * same day can be reversed. Repeating a reversal id never refunds twice.
   */
  reverse(
    reversalId: string,
    saleId: string,
    lines: ReversalLineInput[],
    reason: string,
    now = this.context.clock(),
  ): string {
    if (!reversalId.trim())
      throw new Error("A reversal reference is required.");
    const why = reason.trim();
    if (!why) throw new Error("Choose a reason for the reversal.");
    const seen = new Set<string>();
    for (const line of lines) {
      nonNegativeInteger(line.quantity, "Quantity to reverse");
      if (seen.has(line.saleItemId))
        throw new Error("Each receipt line can be listed only once.");
      seen.add(line.saleItemId);
    }
    const wanted = lines.filter((line) => line.quantity > 0);

    this.db.withTransactionSync(() => {
      if (
        this.db.getFirstSync(
          "SELECT id FROM sale_reversals WHERE id = ?",
          reversalId,
        )
      )
        return;
      const sale = this.db.getFirstSync<{ created_at: string }>(
        "SELECT created_at FROM sales WHERE id = ?",
        saleId,
      );
      if (!sale) throw new Error("This sale no longer exists.");
      if (!sameLocalDay(new Date(sale.created_at), now))
        throw new Error("Only today's sales can be reversed.");
      if (!wanted.length)
        throw new Error("Choose at least one item to reverse.");

      const receipt = new Map(
        this.items(saleId).map((item) => [item.id, item]),
      );
      let refund = 0;
      const rows = wanted.map((line) => {
        const item = receipt.get(line.saleItemId);
        if (!item) throw new Error("This item is not on the receipt.");
        const left = item.quantity - item.reversed_quantity;
        if (line.quantity > left)
          throw new Error(
            left
              ? `Only ${left} of ${item.product_name} · ${item.variant_label} can still be reversed.`
              : `${item.product_name} · ${item.variant_label} is already fully reversed.`,
          );
        const lineRefund = item.unit_price_cents * line.quantity;
        refund += lineRefund;
        return { item, line, lineRefund };
      });

      const at = now.toISOString();
      const { userId, deviceId } = this.context.actor;
      this.db.runSync(
        "INSERT INTO sale_reversals (id, sale_id, reason, refund_cents, actor_user_id, device_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
        reversalId,
        saleId,
        why,
        refund,
        userId,
        deviceId,
        at,
      );
      const returned: (ReversalItemPayload & { variant_id: string })[] =
        rows.map(({ item, line, lineRefund }) => ({
          id: this.context.newId(),
          sale_item_id: item.id,
          variant_id: item.variant_id,
          quantity: line.quantity,
          restocked: line.restock,
          refund_cents: lineRefund,
        }));
      for (const line of returned)
        this.db.runSync(
          "INSERT INTO sale_reversal_items (id, reversal_id, sale_item_id, quantity, restocked, refund_cents) VALUES (?, ?, ?, ?, ?, ?)",
          line.id,
          reversalId,
          line.sale_item_id,
          line.quantity,
          line.restocked ? 1 : 0,
          line.refund_cents,
        );
      const opId = this.outbox.record("reversals", reversalId, {
        id: reversalId,
        sale_id: saleId,
        reason: why,
        refund_cents: refund,
        actor_user_id: userId,
        device_id: deviceId,
        imported: false,
        created_at: at,
        items: returned.map(({ variant_id: _, ...line }) => line),
      });
      for (const line of returned)
        if (line.restocked)
          this.stock.move(line.variant_id, line.quantity, "reversal", {
            refId: reversalId,
            opId,
          });
    });
    return reversalId;
  }

  /**
   * Inside a transaction, for a shop's first upload: queues every sale and reversal made
   * before the shop was registered, marked imported. The server records them without moving
   * stock again (it starts from the opening stock, which already reflects them).
   */
  queueImported(): void {
    this.db.runSync("UPDATE sales SET imported = 1");
    this.db.runSync("UPDATE sale_reversals SET imported = 1");
    for (const sale of this.db.getAllSync<Sale>(
      "SELECT * FROM sales ORDER BY created_at, id",
    )) {
      const items = this.db.getAllSync<SaleItemPayload>(
        "SELECT id, product_id, variant_id, product_name, variant_label, category, barcode, quantity, unit_price_cents, line_total_cents, unit_cost_cents FROM sale_items WHERE sale_id = ? ORDER BY rowid",
        sale.id,
      );
      const payload: SalePayload = {
        id: sale.id,
        total_cents: sale.total_cents,
        tendered_cents: sale.tendered_cents,
        change_cents: sale.change_cents,
        actor_user_id: sale.actor_user_id,
        device_id: sale.device_id,
        imported: true,
        created_at: sale.created_at,
        items,
      };
      this.outbox.record("sales", sale.id, payload);
    }
    for (const reversal of this.db.getAllSync<SaleReversal>(
      "SELECT * FROM sale_reversals ORDER BY created_at, id",
    )) {
      const items = this.db
        .getAllSync<Omit<ReversalItemPayload, "restocked"> & { restocked: number }>(
          "SELECT id, sale_item_id, quantity, restocked, refund_cents FROM sale_reversal_items WHERE reversal_id = ? ORDER BY rowid",
          reversal.id,
        )
        .map((item) => ({ ...item, restocked: item.restocked === 1 }));
      const payload: ReversalPayload = {
        id: reversal.id,
        sale_id: reversal.sale_id,
        reason: reversal.reason,
        refund_cents: reversal.refund_cents,
        actor_user_id: reversal.actor_user_id,
        device_id: reversal.device_id,
        imported: true,
        created_at: reversal.created_at,
        items,
      };
      this.outbox.record("reversals", reversal.id, payload);
    }
  }

  list(limit = 50, offset = 0): Sale[] {
    return this.db.getAllSync<Sale>(
      `SELECT s.*,
        (SELECT SUM(quantity) FROM sale_items WHERE sale_id = s.id) AS item_count,
        COALESCE((SELECT SUM(refund_cents) FROM sale_reversals WHERE sale_id = s.id), 0) AS refunded_cents,
        COALESCE((SELECT SUM(ri.quantity) FROM sale_reversal_items ri JOIN sale_items si ON si.id = ri.sale_item_id WHERE si.sale_id = s.id), 0) AS reversed_count
      FROM sales s ORDER BY s.created_at DESC, s.id DESC LIMIT ? OFFSET ?`,
      limit,
      offset,
    );
  }

  items(saleId: string): SaleItem[] {
    return this.db.getAllSync<SaleItem>(
      `SELECT si.*,
        COALESCE((SELECT SUM(quantity) FROM sale_reversal_items WHERE sale_item_id = si.id), 0) AS reversed_quantity,
        CASE WHEN v.id IS NOT NULL AND v.archived_at IS NULL THEN 1 ELSE 0 END AS variant_active
      FROM sale_items si LEFT JOIN product_variants v ON v.id = si.variant_id
      WHERE si.sale_id = ? ORDER BY si.product_name COLLATE NOCASE, si.variant_label`,
      saleId,
    );
  }

  reversals(saleId: string): SaleReversal[] {
    return this.db.getAllSync<SaleReversal>(
      "SELECT * FROM sale_reversals WHERE sale_id = ? ORDER BY created_at, id",
      saleId,
    );
  }

  /** Stock figures and today's takings, net of today's refunds. */
  dashboard(now = new Date()): Dashboard {
    const { start, end } = periodRange("today", now);
    const stock = this.db.getFirstSync<
      Pick<Dashboard, "product_count" | "unit_count" | "out_of_stock">
    >(
      "SELECT (SELECT COUNT(*) FROM products) AS product_count, COALESCE(SUM(stock), 0) AS unit_count, COALESCE(SUM(CASE WHEN stock <= 0 THEN 1 ELSE 0 END), 0) AS out_of_stock FROM product_variants WHERE archived_at IS NULL",
    )!;
    const today = this.db.getFirstSync<
      Pick<Dashboard, "today_total" | "today_sales">
    >(
      `SELECT COALESCE(SUM(total_cents), 0)
          - COALESCE((SELECT SUM(refund_cents) FROM sale_reversals WHERE created_at >= ?1 AND created_at < ?2), 0) AS today_total,
        COUNT(*) AS today_sales
      FROM sales WHERE created_at >= ?1 AND created_at < ?2`,
      start.toISOString(),
      end.toISOString(),
    )!;
    return { ...stock, ...today };
  }
}
