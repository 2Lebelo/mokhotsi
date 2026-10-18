export type IdFactory = () => string;

export function nonNegativeInteger(value: number, label: string): void {
  if (!Number.isSafeInteger(value) || value < 0)
    throw new Error(`${label} must be a valid non-negative whole number.`);
}

/** Columns of a size joined with its product, for SELECTs over `product_variants v JOIN products p`. */
export const SELLABLE_COLUMNS =
  "v.*, p.name AS product_name, p.category AS category, p.photo_uri AS photo_uri";
