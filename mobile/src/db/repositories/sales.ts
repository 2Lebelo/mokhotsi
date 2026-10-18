import type { SQLiteDatabase } from "expo-sqlite";

import { variantLabel } from "../../domain/units.ts";
import type { Dashboard, Sale, SaleItem } from "../types.ts";
import { cartTotal, type CartRepository } from "./cart.ts";
import type { IdFactory } from "./shared.ts";

export class SalesRepository {
  private db: SQLiteDatabase;
  private newId: IdFactory;
  private cart: CartRepository;

  constructor(db: SQLiteDatabase, newId: IdFactory, cart: CartRepository) {
    this.db = db;
    this.newId = newId;
    this.cart = cart;
  }

  /** Records the cart as a sale. Repeating a sale id never records a second sale. */
  checkout(saleId: string): string {
    if (!saleId.trim()) throw new Error("A sale reference is required.");
    this.db.withTransactionSync(() => {
      if (this.db.getFirstSync("SELECT id FROM sales WHERE id = ?", saleId))
        return;
      const items = this.cart.items();
      if (!items.length)
        throw new Error("Add at least one product to the cart.");
      const total = cartTotal(items);
      const now = new Date().toISOString();
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
        "INSERT INTO sales (id, total_cents, created_at) VALUES (?, ?, ?)",
        saleId,
        total,
        now,
      );
      for (const item of items) {
        const updated = this.db.runSync(
          "UPDATE product_variants SET stock = stock - ?, updated_at = ? WHERE id = ? AND stock >= ? AND archived_at IS NULL",
          item.quantity,
          now,
          item.id,
          item.quantity,
        );
        if (updated.changes !== 1)
          throw new Error(
            `Stock changed for ${item.product_name}. Please review the cart.`,
          );
        this.db.runSync(
          "INSERT INTO sale_items (id, sale_id, product_id, variant_id, product_name, variant_label, category, barcode, quantity, unit_price_cents, line_total_cents) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
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
        );
      }
      this.db.runSync("DELETE FROM cart_items");
    });
    return saleId;
  }

  list(limit = 50, offset = 0): Sale[] {
    return this.db.getAllSync<Sale>(
      "SELECT s.*, (SELECT SUM(quantity) FROM sale_items WHERE sale_id = s.id) AS item_count FROM sales s ORDER BY s.created_at DESC, s.id DESC LIMIT ? OFFSET ?",
      limit,
      offset,
    );
  }

  items(saleId: string): SaleItem[] {
    return this.db.getAllSync<SaleItem>(
      "SELECT * FROM sale_items WHERE sale_id = ? ORDER BY product_name COLLATE NOCASE, variant_label",
      saleId,
    );
  }

  dashboard(now = new Date()): Dashboard {
    const start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const end = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
    const stock = this.db.getFirstSync<
      Pick<Dashboard, "product_count" | "unit_count" | "out_of_stock">
    >(
      "SELECT (SELECT COUNT(*) FROM products) AS product_count, COALESCE(SUM(stock), 0) AS unit_count, COALESCE(SUM(CASE WHEN stock = 0 THEN 1 ELSE 0 END), 0) AS out_of_stock FROM product_variants WHERE archived_at IS NULL",
    )!;
    const today = this.db.getFirstSync<
      Pick<Dashboard, "today_total" | "today_sales">
    >(
      "SELECT COALESCE(SUM(total_cents), 0) AS today_total, COUNT(*) AS today_sales FROM sales WHERE created_at >= ? AND created_at < ?",
      start.toISOString(),
      end.toISOString(),
    )!;
    return { ...stock, ...today };
  }
}
