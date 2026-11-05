import { normalizeBarcode } from "../../domain/barcode.ts";
import {
  DEFAULT_UNIT,
  formatVariantLabel,
  parseSize,
  sizeInput,
} from "../../domain/units.ts";
import type {
  ProductInput,
  ProductWithVariants,
  VariantInput,
} from "../../db/types.ts";
import { parsePrice, parseStock, priceInput } from "../../lib/money.ts";

// Form state is kept as typed text so the cashier's input is never reformatted
// while typing; it is parsed once, on save, by validateProductDraft.

export type VariantField =
  | "size"
  | "unit"
  | "price"
  | "cost"
  | "stock"
  | "barcode";

export type VariantDraft = {
  /** Stable React key; equals `id` for saved sizes. */
  key: string;
  id: string | null;
  size: string;
  unit: string;
  price: string;
  /** Blank means no cost price is recorded. */
  cost: string;
  stock: string;
  /** A saved size's stock when the form opened; the edit is saved as the difference. */
  stockBaseline: number | null;
  barcode: string;
};

export type ProductDraft = {
  name: string;
  category: string;
  /** Main photo (thumbnail) and an optional second angle. */
  photo: string | null;
  photo2: string | null;
  variants: VariantDraft[];
};

export type PhotoSlot = "photo" | "photo2";

export type ProductFormAction =
  | { type: "set-field"; field: "name" | "category"; value: string }
  | { type: "set-photo"; slot: PhotoSlot; uri: string | null }
  | { type: "set-variant"; key: string; field: VariantField; value: string }
  | { type: "add-variant"; key: string }
  | { type: "remove-variant"; key: string };

export type DraftErrors = {
  name?: string;
  category?: string;
  variants: Record<string, Partial<Record<VariantField, string>>>;
};

export type DraftValidation =
  | { ok: true; input: ProductInput }
  | { ok: false; errors: DraftErrors };

function newVariant(key: string, unit = DEFAULT_UNIT): VariantDraft {
  return {
    key,
    id: null,
    size: unit === DEFAULT_UNIT ? "1" : "",
    unit,
    price: "",
    cost: "",
    stock: "",
    stockBaseline: null,
    barcode: "",
  };
}

export function draftFromProduct(
  product: ProductWithVariants | null,
  newKey: () => string,
  barcode?: string,
): ProductDraft {
  if (!product)
    return {
      name: "",
      category: "",
      photo: null,
      photo2: null,
      variants: [{ ...newVariant(newKey()), barcode: barcode ?? "" }],
    };
  return {
    name: product.name,
    category: product.category,
    photo: product.photo_uri,
    photo2: product.photo2_uri ?? null,
    variants: product.variants.map((variant) => ({
      key: variant.id,
      id: variant.id,
      size: sizeInput(variant.size_milli),
      unit: variant.unit,
      price: priceInput(variant.price_cents),
      cost: variant.cost_cents == null ? "" : priceInput(variant.cost_cents),
      stock: String(variant.stock),
      stockBaseline: variant.stock,
      barcode: variant.barcode ?? "",
    })),
  };
}

export function productFormReducer(
  draft: ProductDraft,
  action: ProductFormAction,
): ProductDraft {
  switch (action.type) {
    case "set-field":
      return { ...draft, [action.field]: action.value };
    case "set-photo":
      return { ...draft, [action.slot]: action.uri };
    case "set-variant":
      return {
        ...draft,
        variants: draft.variants.map((variant) =>
          variant.key === action.key
            ? { ...variant, [action.field]: action.value }
            : variant,
        ),
      };
    case "add-variant": {
      // A new size usually shares the unit of the one above it (500 g → 1 kg aside).
      const previous = draft.variants[draft.variants.length - 1];
      return {
        ...draft,
        variants: [...draft.variants, newVariant(action.key, previous?.unit)],
      };
    }
    case "remove-variant":
      return draft.variants.length > 1
        ? {
            ...draft,
            variants: draft.variants.filter((v) => v.key !== action.key),
          }
        : draft;
  }
}

function attempt<T>(
  parse: () => T,
  onError: (message: string) => void,
): T | undefined {
  try {
    return parse();
  } catch (error) {
    onError(error instanceof Error ? error.message : String(error));
    return undefined;
  }
}

export function validateProductDraft(draft: ProductDraft): DraftValidation {
  const errors: DraftErrors = { variants: {} };
  let failed = false;
  if (!draft.name.trim()) {
    errors.name = "Enter a product name.";
    failed = true;
  }
  if (!draft.category.trim()) {
    errors.category = "Enter a category.";
    failed = true;
  }

  const sizes = new Map<string, string>();
  const barcodes = new Set<string>();
  const variants: VariantInput[] = [];
  for (const draftVariant of draft.variants) {
    const fieldErrors: Partial<Record<VariantField, string>> = {};
    const fail = (field: VariantField) => (message: string) => {
      fieldErrors[field] = message;
      failed = true;
    };
    const size = attempt(
      () => parseSize(draftVariant.size, draftVariant.unit),
      fail("size"),
    );
    const price = attempt(() => parsePrice(draftVariant.price), fail("price"));
    const cost = draftVariant.cost.trim()
      ? attempt(() => parsePrice(draftVariant.cost), fail("cost"))
      : null;
    const stock = attempt(() => parseStock(draftVariant.stock), fail("stock"));
    const barcode = normalizeBarcode(draftVariant.barcode);

    if (size !== undefined) {
      const sizeKey = `${draftVariant.unit}:${size}`;
      if (sizes.has(sizeKey))
        fail("size")(
          `${formatVariantLabel(size, draftVariant.unit)} is already listed above.`,
        );
      sizes.set(sizeKey, draftVariant.key);
    }
    if (barcode) {
      if (barcodes.has(barcode))
        fail("barcode")("This barcode is already used for another size.");
      barcodes.add(barcode);
    }
    if (Object.keys(fieldErrors).length)
      errors.variants[draftVariant.key] = fieldErrors;
    else
      variants.push({
        ...(draftVariant.id ? { id: draftVariant.id } : {}),
        ...(draftVariant.id && draftVariant.stockBaseline !== null
          ? { stock_baseline: draftVariant.stockBaseline }
          : {}),
        size_milli: size!,
        unit: draftVariant.unit,
        price_cents: price!,
        cost_cents: cost!,
        stock: stock!,
        barcode,
      });
  }

  if (failed) return { ok: false, errors };
  // A lone second photo becomes the main one, so every product with a photo has a thumbnail.
  const [photo = null, photo2 = null] = [draft.photo, draft.photo2].filter(
    (uri): uri is string => !!uri,
  );
  return {
    ok: true,
    input: {
      name: draft.name,
      category: draft.category,
      photo_uri: photo,
      photo2_uri: photo2 === photo ? null : photo2,
      variants,
    },
  };
}

export const PHOTO_SLOTS: readonly PhotoSlot[] = ["photo", "photo2"];

/**
 * Slots holding a photo added in this form (not one the product already had), whose file
 * `exists` says is gone. Kept photos are not checked: a photo synced from another phone may
 * still be downloading, and saving without touching it is correct.
 */
export function lostPhotoSlots(
  draft: Pick<ProductDraft, PhotoSlot>,
  kept: readonly (string | null | undefined)[],
  exists: (uri: string) => boolean,
): PhotoSlot[] {
  return PHOTO_SLOTS.filter((slot) => {
    const uri = draft[slot];
    return !!uri && !kept.includes(uri) && !exists(uri);
  });
}

/** What to tell the cashier when photos added in this form are no longer on the phone. */
export function lostPhotoMessage(slots: readonly PhotoSlot[]): string {
  if (slots.length > 1)
    return "Both photos are no longer on this phone. Please add them again.";
  const which = slots[0] === "photo2" ? "second" : "front";
  return `The ${which} photo is no longer on this phone. Please add it again.`;
}

/** Profit per unit for a size being edited, or null until price and cost both parse. */
export function draftMargin(
  variant: Pick<VariantDraft, "price" | "cost">,
): { profitCents: number; percent: number | null } | null {
  if (!variant.cost.trim()) return null;
  try {
    const price = parsePrice(variant.price);
    const cost = parsePrice(variant.cost);
    return {
      profitCents: price - cost,
      percent: price > 0 ? Math.round(((price - cost) / price) * 100) : null,
    };
  } catch {
    return null;
  }
}
