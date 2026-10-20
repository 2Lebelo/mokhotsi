import { parsePrice } from "../lib/money.ts";

// Cash at the till works like a calculator: the cashier keys in what the customer
// handed over and the change is worked out. Amounts are integer cents throughout.

/** Maloti notes, in cents, used to suggest the amounts customers usually hand over. */
export const NOTES_CENTS = [1000, 2000, 5000, 10000, 20000] as const;

/** Longest amount the keypad accepts, in whole Maloti digits. */
const MAX_WHOLE_DIGITS = 9;

export type Tender =
  | { status: "empty" }
  | { status: "short"; shortCents: number }
  | { status: "paid"; changeCents: number };

/** Compares the cash handed over with the total due. */
export function tender(
  totalCents: number,
  tenderedCents: number | null,
): Tender {
  if (tenderedCents === null) return { status: "empty" };
  return tenderedCents < totalCents
    ? { status: "short", shortCents: totalCents - tenderedCents }
    : { status: "paid", changeCents: tenderedCents - totalCents };
}

/**
 * One-tap amounts: the exact total, then the next round amount for each note
 * (M85.00 → M90, M100, M200), smallest first, without repeats.
 */
export function quickCash(totalCents: number, max = 4): number[] {
  const amounts = new Set<number>([totalCents]);
  for (const note of NOTES_CENTS) {
    const rounded = Math.ceil(totalCents / note) * note;
    if (rounded > totalCents) amounts.add(rounded);
  }
  return [...amounts].sort((a, b) => a - b).slice(0, max);
}

export type KeypadKey =
  "0" | "1" | "2" | "3" | "4" | "5" | "6" | "7" | "8" | "9" | "." | "back";

/** Applies one keypad press to the typed amount, keeping it a valid price. */
export function pressKey(current: string, key: KeypadKey): string {
  if (key === "back") return current.slice(0, -1);
  const [whole, fraction] = current.split(".");
  if (key === ".") {
    if (fraction !== undefined) return current;
    return current === "" ? "0." : `${current}.`;
  }
  if (fraction !== undefined)
    return fraction.length >= 2 ? current : current + key;
  if (whole === "0") return key;
  return whole.length >= MAX_WHOLE_DIGITS ? current : current + key;
}

/** The typed amount in cents, or null while nothing has been entered. */
export function typedCents(typed: string): number | null {
  if (!typed) return null;
  return parsePrice(typed.endsWith(".") ? typed.slice(0, -1) : typed);
}

/** A cents amount as keypad text: 8500 → "85", 8550 → "85.50". */
export function centsToTyped(cents: number): string {
  const whole = Math.floor(cents / 100);
  const fraction = cents % 100;
  return fraction
    ? `${whole}.${String(fraction).padStart(2, "0")}`
    : String(whole);
}
