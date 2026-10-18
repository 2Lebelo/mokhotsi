import type { ProductWithVariants, SellableVariant } from "../../db/types.ts";

/**
 * Something a camera source recognised. The till consumes these without knowing
 * the source, so on-device models plug in by emitting `visual` recognitions.
 */
export type Recognition =
  | { kind: "barcode"; code: string; symbology: string }
  | { kind: "visual"; productId: string; score: number };

export type Resolution =
  | { status: "matched"; variant: SellableVariant }
  // A visual match identifies a product, not its pack size, so the cashier picks one.
  | { status: "choose-variant"; product: ProductWithVariants }
  | { status: "unknown"; recognition: Recognition };
