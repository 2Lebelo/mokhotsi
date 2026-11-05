import { openDatabaseAsync } from "expo-sqlite";

import { DATABASE_NAME } from "./schema.ts";

/**
 * Whether this phone's original shop file holds items or sales from before registration,
 * worth bringing into the first shop. Read-only, and only while no shop is open (setup).
 */
export async function hasLocalShopData(): Promise<boolean> {
  const db = await openDatabaseAsync(DATABASE_NAME, { useNewConnection: true });
  try {
    const table = await db.getFirstAsync(
      "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name IN ('products', 'sales')",
    );
    if (!table) return false;
    return (
      (await db.getFirstAsync(
        "SELECT 1 FROM products UNION ALL SELECT 1 FROM sales LIMIT 1",
      )) !== null
    );
  } catch {
    return false; // An unreadable or half-made file has nothing to bring.
  } finally {
    await db.closeAsync();
  }
}
