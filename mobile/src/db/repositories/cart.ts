import type { SQLiteDatabase } from "expo-sqlite";

import { variantLabel } from "../../domain/units.ts";
import type { CartItem, SellableVariant } from "../types.ts";
import { nonNegativeInteger, SELLABLE_COLUMNS } from "./shared.ts";

export function cartTotal(items: CartItem[]): number {
  let total = 0;
  for (const item of items) {
    const line = item.price_cents * item.quantity;
    if (!Number.isSafeInteger(line) || !Number.isSafeInteger(total + line)) {
      throw new Error(
        "The cart total is too large. Reduce the quantity before continuing.",
      );
    }
    total += line;
  }
  return total;
}

export class CartRepository {
  private db: SQLiteDatabase;

  constructor(db: SQLiteDatabase) {
    this.db = db;
  }

  items(): CartItem[] {
    return this.db.getAllSync<CartItem>(
      `SELECT ${SELLABLE_COLUMNS}, c.quantity FROM cart_items c JOIN product_variants v ON v.id = c.variant_id JOIN products p ON p.id = v.product_id ORDER BY p.name COLLATE NOCASE, v.position, v.id`,
    );
  }

  item(variantId: string): CartItem | null {
    return this.db.getFirstSync<CartItem>(
      `SELECT ${SELLABLE_COLUMNS}, c.quantity FROM cart_items c JOIN product_variants v ON v.id = c.variant_id JOIN products p ON p.id = v.product_id WHERE c.variant_id = ?`,
      variantId,
    );
  }

  /** Total units in the cart, for badges. */
  count(): number {
    return (
      this.db.getFirstSync<{ count: number }>(
        "SELECT COALESCE(SUM(quantity), 0) AS count FROM cart_items",
      )?.count ?? 0
    );
  }

  setQuantity(variantId: string, quantity: number): void {
    nonNegativeInteger(quantity, "Quantity");
    this.db.withTransactionSync(() => {
      if (quantity === 0) {
        this.db.runSync(
          "DELETE FROM cart_items WHERE variant_id = ?",
          variantId,
        );
        return;
      }
      const variant = this.db.getFirstSync<SellableVariant>(
        `SELECT ${SELLABLE_COLUMNS} FROM product_variants v JOIN products p ON p.id = v.product_id WHERE v.id = ?`,
        variantId,
      );
      if (!variant) throw new Error("This product no longer exists.");
      const name = `${variant.product_name} · ${variantLabel(variant)}`;
      if (variant.archived_at)
        throw new Error(`${name} is no longer sold. Choose another size.`);
      const current = this.item(variantId)?.quantity ?? 0;
      // Reducing an over-stock quantity is always allowed so the cart can be fixed.
      if (quantity > variant.stock && quantity >= current)
        throw new Error(
          variant.stock === 0
            ? `${name} is out of stock. Update its stock to sell it.`
            : `Only ${variant.stock} of ${name} available. Update stock or reduce the quantity.`,
        );
      this.db.runSync(
        "INSERT INTO cart_items (variant_id, quantity) VALUES (?, ?) ON CONFLICT(variant_id) DO UPDATE SET quantity = excluded.quantity",
        variantId,
        quantity,
      );
      cartTotal(this.items());
    });
  }

  /** Adds one unit and returns the updated cart line. */
  add(variantId: string): CartItem {
    this.setQuantity(variantId, (this.item(variantId)?.quantity ?? 0) + 1);
    return this.item(variantId)!;
  }

  clear(): void {
    this.db.runSync("DELETE FROM cart_items");
  }
}
