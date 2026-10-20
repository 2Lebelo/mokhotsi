import { toSellable } from "../../db/repositories/catalogue.ts";
import type { ProductWithVariants, SellableVariant } from "../../db/types.ts";
import type { Recognition, Resolution } from "./types.ts";

export type CatalogueLookup = {
  variantByBarcode(code: string): SellableVariant | null;
  product(id: string): ProductWithVariants | null;
};

export function resolveRecognition(
  catalogue: CatalogueLookup,
  recognition: Recognition,
): Resolution {
  switch (recognition.kind) {
    case "barcode": {
      const variant = catalogue.variantByBarcode(recognition.code);
      return variant
        ? { status: "matched", variant }
        : { status: "unknown", recognition };
    }
    case "visual": {
      const product = catalogue.product(recognition.productId);
      if (!product?.variants.length) return { status: "unknown", recognition };
      return product.variants.length === 1
        ? {
            status: "matched",
            variant: toSellable(product, product.variants[0]),
          }
        : { status: "choose-variant", product };
    }
  }
}
