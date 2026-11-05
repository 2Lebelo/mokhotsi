export type IdFactory = () => string;
export type Clock = () => Date;

/** Who is making a change, on which phone. Stamped on sales, reversals, and stock movements. */
export type Actor = { userId: string; deviceId: string };

/** Before a shop is registered every change is made by the phone itself. */
export const LOCAL_ACTOR: Actor = { userId: "local", deviceId: "local" };

/** What every repository write needs besides the database. Tests pass fakes. */
export type StoreContext = { newId: IdFactory; clock: Clock; actor: Actor };

export function nonNegativeInteger(value: number, label: string): void {
  if (!Number.isSafeInteger(value) || value < 0)
    throw new Error(`${label} must be a valid non-negative whole number.`);
}

/** Columns of a size joined with its product, for SELECTs over `product_variants v JOIN products p`. */
export const SELLABLE_COLUMNS =
  "v.*, p.name AS product_name, p.category AS category, p.photo_uri AS photo_uri";
