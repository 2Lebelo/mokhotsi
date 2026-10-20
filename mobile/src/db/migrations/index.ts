import { initial } from "./001-initial.ts";
import { productVariants } from "./002-product-variants.ts";
import { productEmbeddings } from "./003-product-embeddings.ts";
import { productSecondPhoto } from "./004-product-second-photo.ts";
import { saleCash } from "./005-sale-cash.ts";
import type { Migration } from "./types.ts";

/** Ordered, append-only. A new schema change is a new file added to the end. */
export const MIGRATIONS: readonly Migration[] = [
  initial,
  productVariants,
  productEmbeddings,
  productSecondPhoto,
  saleCash,
];
