import { initial } from "./001-initial.ts";
import { productVariants } from "./002-product-variants.ts";
import type { Migration } from "./types.ts";

/** Ordered, append-only. A new schema change is a new file added to the end. */
export const MIGRATIONS: readonly Migration[] = [initial, productVariants];
