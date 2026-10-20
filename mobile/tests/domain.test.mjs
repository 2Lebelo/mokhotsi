import assert from "node:assert/strict";
import test from "node:test";

import { normalizeBarcode } from "../src/domain/barcode.ts";
import {
  centsToTyped,
  pressKey,
  quickCash,
  tender,
  typedCents,
} from "../src/domain/cash.ts";
import {
  formatVariantLabel,
  parseSize,
  sizeInput,
  UNITS,
} from "../src/domain/units.ts";
import {
  draftFromProduct,
  productFormReducer,
  validateProductDraft,
} from "../src/features/products/product-form.ts";
import { matchesProduct } from "../src/features/products/search.ts";
import { resolveRecognition } from "../src/features/recognition/resolve.ts";
import { ScanGate } from "../src/features/scanner/scan-gate.ts";
import {
  initialTillState,
  isScanning,
  tillReducer,
} from "../src/features/till/till-reducer.ts";

test("sizes are parsed into thousandths and labelled per unit", () => {
  assert.equal(parseSize("2.5", "kg"), 2500);
  assert.equal(parseSize("500", "g"), 500000);
  assert.equal(parseSize("0,75", "l"), 750);
  assert.equal(parseSize("6", "pack"), 6000);
  assert.equal(formatVariantLabel(2500, "kg"), "2.5 kg");
  assert.equal(formatVariantLabel(500000, "g"), "500 g");
  assert.equal(formatVariantLabel(2000, "l"), "2 L");
  assert.equal(formatVariantLabel(500000, "ml"), "500 mL");
  assert.equal(formatVariantLabel(6000, "pack"), "Pack of 6");
  assert.equal(formatVariantLabel(30000, "tray"), "Tray of 30");
  assert.equal(formatVariantLabel(1000, "bottle"), "Bottle");
  assert.equal(formatVariantLabel(1000, "pcs"), "Each");
  assert.equal(formatVariantLabel(3000, "pcs"), "3 pcs");
  assert.equal(formatVariantLabel(1500, "m"), "1.5 m");
  assert.equal(sizeInput(2500), "2.5");
  for (const [text, unit] of [
    ["0", "kg"],
    ["-1", "kg"],
    ["1.2345", "kg"],
    ["1.5", "pack"],
    ["abc", "g"],
    ["1", "furlong"],
  ])
    assert.throws(() => parseSize(text, unit), `${text} ${unit}`);
  assert.equal(new Set(UNITS.map((unit) => unit.code)).size, UNITS.length);
});

test("barcodes are normalised to one canonical form", () => {
  assert.equal(normalizeBarcode(" 6001 234567890 "), "6001234567890");
  assert.equal(normalizeBarcode("012345678905"), "0012345678905");
  assert.equal(normalizeBarcode("ABC-123"), "ABC-123");
  assert.equal(normalizeBarcode("   "), null);
  assert.equal(normalizeBarcode(null), null);
});

test("the scan gate accepts a code once while it stays in view", () => {
  let now = 0;
  const gate = new ScanGate(1000, () => now);
  assert.equal(gate.accept("A"), true);
  now = 400;
  assert.equal(gate.accept("A"), false);
  now = 1200; // still in view: each sighting extends the window
  assert.equal(gate.accept("A"), false);
  now = 1300;
  assert.equal(gate.accept("B"), true);
  now = 1350;
  assert.equal(gate.accept("A"), true);
  now = 2600; // out of view for longer than the window
  assert.equal(gate.accept("A"), true);
});

test("the till only scans while no sheet is open", () => {
  let state = initialTillState;
  assert.equal(isScanning(state), true);
  state = tillReducer(state, { type: "unknown-code", code: "123" });
  assert.deepEqual(state.sheet, { kind: "unknown", code: "123" });
  assert.equal(isScanning(state), false);
  state = tillReducer(state, { type: "close-sheet" });
  state = tillReducer(state, { type: "added", variantId: "v1" });
  assert.equal(state.lastVariantId, "v1");
  state = tillReducer(state, { type: "failed", message: "Out of stock" });
  assert.equal(state.error, "Out of stock");
  assert.equal(isScanning(state), true);
  state = tillReducer(state, { type: "choose-variant", productId: "p1" });
  assert.equal(state.error, null);
  state = tillReducer(state, { type: "removed", variantId: "v1" });
  assert.equal(state.lastVariantId, null);
});

const variant = (id, changes = {}) => ({
  id,
  product_id: "p1",
  size_milli: 1000,
  unit: "pcs",
  price_cents: 100,
  stock: 5,
  barcode: null,
  position: 0,
  archived_at: null,
  created_at: "",
  updated_at: "",
  ...changes,
});
const sugar = {
  id: "p1",
  name: "Sugar",
  category: "Groceries",
  photo_uri: null,
  created_at: "",
  updated_at: "",
  variants: [
    variant("v1", { unit: "g", size_milli: 500000, barcode: "600111" }),
    variant("v2", { unit: "kg", size_milli: 2000 }),
  ],
};

test("recognitions resolve to a size, a size choice, or unknown", () => {
  const catalogue = {
    variantByBarcode: (code) =>
      code === "600111"
        ? { ...sugar.variants[0], product_name: "Sugar" }
        : null,
    product: (id) =>
      id === "p1"
        ? sugar
        : id === "p2"
          ? { ...sugar, id: "p2", variants: [variant("v3")] }
          : null,
  };
  const barcode = (code) => ({ kind: "barcode", code, symbology: "ean13" });
  assert.equal(
    resolveRecognition(catalogue, barcode("600111")).variant.id,
    "v1",
  );
  assert.equal(resolveRecognition(catalogue, barcode("000")).status, "unknown");
  const visual = (productId) => ({ kind: "visual", productId, score: 0.9 });
  assert.equal(
    resolveRecognition(catalogue, visual("p1")).status,
    "choose-variant",
  );
  const single = resolveRecognition(catalogue, visual("p2"));
  assert.equal(single.variant.id, "v3");
  assert.equal(single.variant.product_name, "Sugar");
  assert.equal(resolveRecognition(catalogue, visual("nope")).status, "unknown");
});

test("product search matches names, categories, and size barcodes", () => {
  assert.equal(matchesProduct(sugar, "sug"), true);
  assert.equal(matchesProduct(sugar, "grocer"), true);
  assert.equal(matchesProduct(sugar, "600111"), true);
  assert.equal(matchesProduct(sugar, "milk"), false);
  assert.equal(matchesProduct(sugar, " "), true);
});

test("the product form validates every size and builds the store input", () => {
  let key = 0;
  const newKey = () => `k${++key}`;
  let draft = draftFromProduct(null, newKey, "6001234567890");
  assert.equal(draft.variants[0].barcode, "6001234567890");
  draft = productFormReducer(draft, {
    type: "set-field",
    field: "name",
    value: "Sugar",
  });
  draft = productFormReducer(draft, {
    type: "set-field",
    field: "category",
    value: "Groceries",
  });
  const first = draft.variants[0].key;
  for (const [field, value] of [
    ["unit", "g"],
    ["size", "500"],
    ["price", "15"],
    ["stock", "10"],
  ])
    draft = productFormReducer(draft, {
      type: "set-variant",
      key: first,
      field,
      value,
    });
  draft = productFormReducer(draft, { type: "add-variant", key: newKey() });
  const second = draft.variants[1].key;
  assert.equal(draft.variants[1].unit, "g");

  // An unfinished second size and a duplicate barcode are reported per field.
  draft = productFormReducer(draft, {
    type: "set-variant",
    key: second,
    field: "barcode",
    value: "6001234567890",
  });
  let result = validateProductDraft(draft);
  assert.equal(result.ok, false);
  assert.ok(result.errors.variants[second].size);
  assert.ok(result.errors.variants[second].price);
  assert.ok(result.errors.variants[second].barcode);
  assert.equal(result.errors.variants[first], undefined);

  for (const [field, value] of [
    ["unit", "kg"],
    ["size", "2"],
    ["price", "50.00"],
    ["stock", "3"],
    ["barcode", ""],
  ])
    draft = productFormReducer(draft, {
      type: "set-variant",
      key: second,
      field,
      value,
    });
  result = validateProductDraft(draft);
  assert.equal(result.ok, true);
  assert.deepEqual(result.input.variants, [
    {
      size_milli: 500000,
      unit: "g",
      price_cents: 1500,
      stock: 10,
      barcode: "6001234567890",
    },
    {
      size_milli: 2000,
      unit: "kg",
      price_cents: 5000,
      stock: 3,
      barcode: null,
    },
  ]);

  draft = productFormReducer(draft, { type: "remove-variant", key: second });
  draft = productFormReducer(draft, { type: "remove-variant", key: first });
  assert.equal(draft.variants.length, 1, "the last size cannot be removed");
});

test("editing a product keeps saved size ids", () => {
  const draft = draftFromProduct(sugar, () => "new");
  assert.deepEqual(
    draft.variants.map((v) => [v.key, v.size, v.unit, v.price]),
    [
      ["v1", "500", "g", "1.00"],
      ["v2", "2", "kg", "1.00"],
    ],
  );
  const result = validateProductDraft(draft);
  assert.equal(result.ok, true);
  assert.deepEqual(
    result.input.variants.map((v) => v.id),
    ["v1", "v2"],
  );
});

test("cash received is compared with the total to give change", () => {
  assert.deepEqual(tender(8500, null), { status: "empty" });
  assert.deepEqual(tender(8500, 8000), { status: "short", shortCents: 500 });
  assert.deepEqual(tender(8500, 8500), { status: "paid", changeCents: 0 });
  assert.deepEqual(tender(8500, 10000), { status: "paid", changeCents: 1500 });
});

test("quick cash offers the exact total and the next round note amounts", () => {
  assert.deepEqual(quickCash(8500), [8500, 9000, 10000, 20000]);
  assert.deepEqual(quickCash(10000), [10000, 20000]);
  assert.deepEqual(quickCash(1234), [1234, 2000, 5000, 10000]);
  assert.deepEqual(quickCash(0), [0]);
});

test("the cash keypad keeps the typed amount a valid price", () => {
  const type = (keys) => keys.reduce(pressKey, "");
  assert.equal(type(["1", "0", "0"]), "100");
  assert.equal(type(["0", "5"]), "5", "no leading zeros");
  assert.equal(type([".", "5"]), "0.5");
  assert.equal(type(["2", ".", ".", "5", "0", "9"]), "2.50");
  assert.equal(type(["9", "back", "back"]), "");
  assert.equal(type(Array(12).fill("9")).length, 9);
  assert.equal(typedCents(""), null);
  assert.equal(typedCents("85"), 8500);
  assert.equal(typedCents("85."), 8500);
  assert.equal(typedCents("85.5"), 8550);
  assert.equal(centsToTyped(8500), "85");
  assert.equal(centsToTyped(8550), "85.50");
  assert.equal(typedCents(centsToTyped(1205)), 1205);
});

test("a lone second photo becomes the product's main photo", () => {
  let draft = draftFromProduct(null, () => "k", undefined);
  draft = productFormReducer(draft, {
    type: "set-field",
    field: "name",
    value: "Soap",
  });
  draft = productFormReducer(draft, {
    type: "set-field",
    field: "category",
    value: "Household",
  });
  draft = productFormReducer(draft, {
    type: "set-variant",
    key: "k",
    field: "price",
    value: "12",
  });
  draft = productFormReducer(draft, {
    type: "set-variant",
    key: "k",
    field: "stock",
    value: "3",
  });
  draft = productFormReducer(draft, {
    type: "set-photo",
    slot: "photo2",
    uri: "file:///b.jpg",
  });
  let result = validateProductDraft(draft);
  assert.equal(result.ok, true);
  assert.equal(result.input.photo_uri, "file:///b.jpg");
  assert.equal(result.input.photo2_uri, null);

  draft = productFormReducer(draft, {
    type: "set-photo",
    slot: "photo",
    uri: "file:///a.jpg",
  });
  result = validateProductDraft(draft);
  assert.equal(result.input.photo_uri, "file:///a.jpg");
  assert.equal(result.input.photo2_uri, "file:///b.jpg");
});
