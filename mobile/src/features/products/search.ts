import { normalizeBarcode } from "../../domain/barcode.ts";
import type { ProductWithVariants } from "../../db/types.ts";

/** Matches name, category, or any size's barcode (in either UPC or EAN form). */
export function matchesProduct(
  product: ProductWithVariants,
  query: string,
): boolean {
  const search = query.trim().toLocaleLowerCase();
  if (!search) return true;
  if (
    product.name.toLocaleLowerCase().includes(search) ||
    product.category.toLocaleLowerCase().includes(search)
  )
    return true;
  const code = normalizeBarcode(search) ?? search;
  return product.variants.some(
    (variant) =>
      !!variant.barcode &&
      (variant.barcode.includes(search) || variant.barcode.includes(code)),
  );
}
