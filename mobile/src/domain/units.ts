import { formatFixed, parseFixed } from "../lib/decimal.ts";

export type UnitDimension = "weight" | "volume" | "count" | "length";

export type UnitDef = {
  /** Stable code stored in the database. Never rename an existing code. */
  code: string;
  label: string;
  symbol: string;
  dimension: UnitDimension;
};

/** Sizes are stored in thousandths of a unit: 2.5 kg is 2500, never a float. */
export const SIZE_SCALE = 1000;
const SIZE_DECIMALS = 3;

export const DEFAULT_UNIT = "pcs";

// Adding a unit is a one-line change here; the database only stores the code.
export const UNITS: readonly UnitDef[] = [
  { code: "kg", label: "Kilogram", symbol: "kg", dimension: "weight" },
  { code: "g", label: "Gram", symbol: "g", dimension: "weight" },
  { code: "mg", label: "Milligram", symbol: "mg", dimension: "weight" },
  { code: "l", label: "Litre", symbol: "L", dimension: "volume" },
  { code: "ml", label: "Millilitre", symbol: "mL", dimension: "volume" },
  { code: "pcs", label: "Piece", symbol: "pcs", dimension: "count" },
  { code: "pack", label: "Pack", symbol: "pack", dimension: "count" },
  { code: "box", label: "Box", symbol: "box", dimension: "count" },
  { code: "carton", label: "Carton", symbol: "carton", dimension: "count" },
  { code: "bottle", label: "Bottle", symbol: "bottle", dimension: "count" },
  { code: "can", label: "Can", symbol: "can", dimension: "count" },
  { code: "sachet", label: "Sachet", symbol: "sachet", dimension: "count" },
  { code: "bag", label: "Bag", symbol: "bag", dimension: "count" },
  { code: "tray", label: "Tray", symbol: "tray", dimension: "count" },
  { code: "m", label: "Metre", symbol: "m", dimension: "length" },
  { code: "cm", label: "Centimetre", symbol: "cm", dimension: "length" },
];

export const DIMENSIONS: readonly {
  dimension: UnitDimension;
  label: string;
}[] = [
  { dimension: "weight", label: "Weight" },
  { dimension: "volume", label: "Volume" },
  { dimension: "count", label: "Quantity" },
  { dimension: "length", label: "Length" },
];

const byCode = new Map(UNITS.map((unit) => [unit.code, unit]));

export function unitByCode(code: string): UnitDef | undefined {
  return byCode.get(code);
}

export function unitsByDimension(dimension: UnitDimension): UnitDef[] {
  return UNITS.filter((unit) => unit.dimension === dimension);
}

/** Count units ("Pack of 6") hold whole numbers; measures ("2.5 kg") may not. */
export function isCountUnit(code: string): boolean {
  return unitByCode(code)?.dimension === "count";
}

export function formatVariantLabel(
  sizeMilli: number,
  unitCode: string,
): string {
  const unit = unitByCode(unitCode);
  const amount = formatFixed(sizeMilli, SIZE_DECIMALS);
  if (!unit) return `${amount} ${unitCode}`;
  if (unit.dimension !== "count") return `${amount} ${unit.symbol}`;
  if (unit.code === "pcs")
    return sizeMilli === SIZE_SCALE ? "Each" : `${amount} pcs`;
  return sizeMilli === SIZE_SCALE ? unit.label : `${unit.label} of ${amount}`;
}

export function variantLabel(variant: { size_milli: number; unit: string }) {
  return formatVariantLabel(variant.size_milli, variant.unit);
}

/** Parses typed size text for a unit into thousandths. */
export function parseSize(text: string, unitCode: string): number {
  const unit = unitByCode(unitCode);
  if (!unit) throw new Error("Choose a unit for this size.");
  const counted = unit.dimension === "count";
  const scaled = parseFixed(text, counted ? 0 : SIZE_DECIMALS);
  if (scaled === null)
    throw new Error(
      counted
        ? `Enter how many items are in one ${unit.label.toLowerCase()}, as a whole number.`
        : "Enter a size with no more than three decimal places.",
    );
  const milli = counted ? scaled * BigInt(SIZE_SCALE) : scaled;
  if (milli <= 0n) throw new Error("A size must be more than zero.");
  if (milli > BigInt(Number.MAX_SAFE_INTEGER))
    throw new Error("This size is too large.");
  return Number(milli);
}

export function sizeInput(sizeMilli: number): string {
  return formatFixed(sizeMilli, SIZE_DECIMALS);
}

/** Store-side check for sizes that did not come through parseSize. */
export function assertValidSize(sizeMilli: number, unitCode: string): void {
  if (!unitByCode(unitCode)) throw new Error("Choose a unit for every size.");
  if (!Number.isSafeInteger(sizeMilli) || sizeMilli <= 0)
    throw new Error("A size must be more than zero.");
  if (isCountUnit(unitCode) && sizeMilli % SIZE_SCALE !== 0)
    throw new Error("Count units such as packs and trays need a whole number.");
}
