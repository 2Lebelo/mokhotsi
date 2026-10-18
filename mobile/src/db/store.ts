import type { SQLiteDatabase } from "expo-sqlite";

export type Product = {
  id: string;
  name: string;
  category: string;
  price_cents: number;
  stock: number;
  barcode: string | null;
  photo_uri: string | null;
  created_at: string;
  updated_at: string;
};

export type ProductInput = Pick<
  Product,
  "name" | "category" | "price_cents" | "stock" | "barcode" | "photo_uri"
>;
export type CartItem = Product & { quantity: number };
export type Sale = {
  id: string;
  total_cents: number;
  created_at: string;
  item_count: number;
};
export type SaleItem = {
  id: string;
  sale_id: string;
  product_id: string;
  product_name: string;
  category: string;
  barcode: string | null;
  quantity: number;
  unit_price_cents: number;
  line_total_cents: number;
};
export type Dashboard = {
  product_count: number;
  unit_count: number;
  out_of_stock: number;
  today_total: number;
  today_sales: number;
};

function nonNegativeInteger(value: number, label: string) {
  if (!Number.isSafeInteger(value) || value < 0)
    throw new Error(`${label} must be a valid non-negative whole number.`);
}

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

export class ShopStore {
  readonly revision: number;
  private db: SQLiteDatabase;
  private newId: () => string;

  constructor(db: SQLiteDatabase, newId: () => string, revision = 0) {
    this.db = db;
    this.newId = newId;
    this.revision = revision;
  }

  products(): Product[] {
    return this.db.getAllSync<Product>(
      "SELECT * FROM products ORDER BY name COLLATE NOCASE, id",
    );
  }

  product(id: string): Product | null {
    return this.db.getFirstSync<Product>(
      "SELECT * FROM products WHERE id = ?",
      id,
    );
  }

  saveProduct(input: ProductInput, id?: string): string {
    const name = input.name.trim();
    const category = input.category.trim();
    const barcode = input.barcode?.trim() || null;
    if (!name) throw new Error("Enter a product name.");
    if (!category) throw new Error("Enter a category.");
    nonNegativeInteger(input.price_cents, "Price");
    nonNegativeInteger(input.stock, "Stock");
    const productId = id ?? this.newId();
    const now = new Date().toISOString();
    this.db.withTransactionSync(() => {
      if (
        barcode &&
        this.db.getFirstSync(
          "SELECT id FROM products WHERE barcode = ? AND id <> ?",
          barcode,
          productId,
        )
      ) {
        throw new Error("That barcode already belongs to another product.");
      }
      if (id) {
        if (!this.product(id))
          throw new Error("This product no longer exists.");
        this.db.runSync(
          "UPDATE products SET name = ?, category = ?, price_cents = ?, stock = ?, barcode = ?, photo_uri = ?, updated_at = ? WHERE id = ?",
          name,
          category,
          input.price_cents,
          input.stock,
          barcode,
          input.photo_uri,
          now,
          id,
        );
      } else {
        this.db.runSync(
          "INSERT INTO products (id, name, category, price_cents, stock, barcode, photo_uri, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
          productId,
          name,
          category,
          input.price_cents,
          input.stock,
          barcode,
          input.photo_uri,
          now,
          now,
        );
      }
    });
    return productId;
  }

  cart(): CartItem[] {
    return this.db.getAllSync<CartItem>(
      "SELECT p.*, c.quantity FROM cart_items c JOIN products p ON p.id = c.product_id ORDER BY p.name COLLATE NOCASE",
    );
  }

  setQuantity(productId: string, quantity: number): void {
    nonNegativeInteger(quantity, "Quantity");
    this.db.withTransactionSync(() => {
      if (quantity === 0) {
        this.db.runSync(
          "DELETE FROM cart_items WHERE product_id = ?",
          productId,
        );
        return;
      }
      const product = this.product(productId);
      if (!product) throw new Error("This product no longer exists.");
      const current =
        this.db.getFirstSync<{ quantity: number }>(
          "SELECT quantity FROM cart_items WHERE product_id = ?",
          productId,
        )?.quantity ?? 0;
      if (quantity > product.stock && quantity >= current)
        throw new Error(
          `Only ${product.stock} of ${product.name} available. Update stock or reduce the quantity.`,
        );
      this.db.runSync(
        "INSERT INTO cart_items (product_id, quantity) VALUES (?, ?) ON CONFLICT(product_id) DO UPDATE SET quantity = excluded.quantity",
        productId,
        quantity,
      );
      cartTotal(this.cart());
    });
  }

  addToCart(productId: string): void {
    const existing = this.db.getFirstSync<{ quantity: number }>(
      "SELECT quantity FROM cart_items WHERE product_id = ?",
      productId,
    );
    this.setQuantity(productId, (existing?.quantity ?? 0) + 1);
  }

  clearCart(): void {
    this.db.runSync("DELETE FROM cart_items");
  }

  checkout(saleId: string): string {
    if (!saleId.trim()) throw new Error("A sale reference is required.");
    this.db.withTransactionSync(() => {
      // A repeated confirmation uses the same ID and never records a second sale.
      if (this.db.getFirstSync("SELECT id FROM sales WHERE id = ?", saleId))
        return;
      const items = this.cart();
      if (!items.length)
        throw new Error("Add at least one product to the cart.");
      const total = cartTotal(items);
      const now = new Date().toISOString();
      for (const item of items) {
        if (item.quantity > item.stock)
          throw new Error(
            `Not enough stock for ${item.name}. Available: ${item.stock}. Update the cart or stock.`,
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
          "UPDATE products SET stock = stock - ?, updated_at = ? WHERE id = ? AND stock >= ?",
          item.quantity,
          now,
          item.id,
          item.quantity,
        );
        if (updated.changes !== 1)
          throw new Error(
            `Stock changed for ${item.name}. Please review the cart.`,
          );
        this.db.runSync(
          "INSERT INTO sale_items (id, sale_id, product_id, product_name, category, barcode, quantity, unit_price_cents, line_total_cents) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
          this.newId(),
          saleId,
          item.id,
          item.name,
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

  sales(limit = 50, offset = 0): Sale[] {
    return this.db.getAllSync<Sale>(
      "SELECT s.*, (SELECT SUM(quantity) FROM sale_items WHERE sale_id = s.id) AS item_count FROM sales s ORDER BY s.created_at DESC, s.id DESC LIMIT ? OFFSET ?",
      limit,
      offset,
    );
  }

  saleItems(saleId: string): SaleItem[] {
    return this.db.getAllSync<SaleItem>(
      "SELECT * FROM sale_items WHERE sale_id = ? ORDER BY product_name COLLATE NOCASE",
      saleId,
    );
  }

  dashboard(now = new Date()): Dashboard {
    const start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const end = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
    const products = this.db.getFirstSync<
      Pick<Dashboard, "product_count" | "unit_count" | "out_of_stock">
    >(
      "SELECT COUNT(*) AS product_count, COALESCE(SUM(stock), 0) AS unit_count, COALESCE(SUM(CASE WHEN stock = 0 THEN 1 ELSE 0 END), 0) AS out_of_stock FROM products",
    )!;
    const today = this.db.getFirstSync<
      Pick<Dashboard, "today_total" | "today_sales">
    >(
      "SELECT COALESCE(SUM(total_cents), 0) AS today_total, COUNT(*) AS today_sales FROM sales WHERE created_at >= ? AND created_at < ?",
      start.toISOString(),
      end.toISOString(),
    )!;
    return { ...products, ...today };
  }
}
