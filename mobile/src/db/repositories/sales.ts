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
import { cartTotal, type CartRepository } from "./cart.ts";
import { nonNegativeInteger, type IdFactory } from "./shared.ts";

export class SalesRepository {
  private db: SQLiteDatabase;
  private newId: IdFactory;
  private cart: CartRepository;

  constructor(db: SQLiteDatabase, newId: IdFactory, cart: CartRepository) {
    this.db = db;
    this.newId = newId;
    this.cart = cart;
  }

  /**
   * Records the cart as a sale paid in cash. Repeating a sale id never records a
   * second sale. `tenderedCents` is the cash handed over (exact cash if omitted);
   * the change is stored with the sale for its receipt. Each line keeps the
   * size's cost at the time of sale, so later cost edits never rewrite profit.
   */
  checkout(saleId: string, tenderedCents?: number, now = new Date()): string {
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
      this.db.runSync(
        "INSERT INTO sales (id, total_cents, tendered_cents, change_cents, created_at) VALUES (?, ?, ?, ?, ?)",
        saleId,
        total,
        tendered,
        tendered - total,
        at,
      );
      for (const item of items) {
        const updated = this.db.runSync(
          "UPDATE product_variants SET stock = stock - ?, updated_at = ? WHERE id = ? AND stock >= ? AND archived_at IS NULL",
          item.quantity,
          at,
          item.id,
          item.quantity,
        );
        if (updated.changes !== 1)
          throw new Error(
            `Stock changed for ${item.product_name}. Please review the cart.`,
          );
        this.db.runSync(
          "INSERT INTO sale_items (id, sale_id, product_id, variant_id, product_name, variant_label, category, barcode, quantity, unit_price_cents, line_total_cents, unit_cost_cents) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
          this.newId(),
          saleId,
          item.product_id,
          item.id,
          item.product_name,
          variantLabel(item),
          item.category,
          item.barcode,
          item.quantity,
          item.price_cents,
          item.price_cents * item.quantity,
          item.cost_cents ?? null,
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
    now = new Date(),
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
      this.db.runSync(
        "INSERT INTO sale_reversals (id, sale_id, reason, refund_cents, created_at) VALUES (?, ?, ?, ?, ?)",
        reversalId,
        saleId,
        why,
        refund,
        at,
      );
      for (const { item, line, lineRefund } of rows) {
        this.db.runSync(
          "INSERT INTO sale_reversal_items (id, reversal_id, sale_item_id, quantity, restocked, refund_cents) VALUES (?, ?, ?, ?, ?, ?)",
          this.newId(),
          reversalId,
          item.id,
          line.quantity,
          line.restock ? 1 : 0,
          lineRefund,
        );
        if (line.restock)
          this.db.runSync(
            "UPDATE product_variants SET stock = stock + ?, updated_at = ? WHERE id = ?",
            line.quantity,
            at,
            item.variant_id,
          );
      }
    });
    return reversalId;
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
      "SELECT (SELECT COUNT(*) FROM products) AS product_count, COALESCE(SUM(stock), 0) AS unit_count, COALESCE(SUM(CASE WHEN stock = 0 THEN 1 ELSE 0 END), 0) AS out_of_stock FROM product_variants WHERE archived_at IS NULL",
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
