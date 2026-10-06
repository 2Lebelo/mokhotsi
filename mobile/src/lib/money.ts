/**
 * Money is always an integer number of cents (lisente). Never store or sum floats.
 * Display currency is the Lesotho loti, written with the `M` symbol (M12.50).
 */
export type Cents = number;

export const CURRENCY_SYMBOL = 'M';

export function isCents(value: unknown): value is Cents {
  return typeof value === 'number' && Number.isSafeInteger(value);
}

export function assertCents(value: unknown, label = 'amount'): asserts value is Cents {
  if (!isCents(value)) {
    throw new TypeError(`${label} must be an integer number of cents, got ${String(value)}`);
  }
}

/** 1250 → "M12.50", -5 → "-M0.05". */
export function formatCents(cents: Cents, symbol: string = CURRENCY_SYMBOL): string {
  assertCents(cents);
  const sign = cents < 0 ? '-' : '';
  const abs = Math.abs(cents);
  const whole = Math.floor(abs / 100);
  const frac = String(abs % 100).padStart(2, '0');
  return `${sign}${symbol}${whole}.${frac}`;
}

/**
 * Parse user input such as "12", "12.5", "12.50", "M12.50" into cents.
 * Returns null for anything that is not a plain non-negative amount with ≤ 2 decimals.
 */
export function parseToCents(input: string): Cents | null {
  const trimmed = input.trim().replace(/^M\s*/i, '');
  const match = /^(\d+)(?:\.(\d{1,2}))?$/.exec(trimmed);
  if (!match) return null;
  const whole = Number(match[1]);
  const frac = Number((match[2] ?? '').padEnd(2, '0'));
  const cents = whole * 100 + frac;
  return Number.isSafeInteger(cents) ? cents : null;
}

export function sumCents(values: readonly Cents[]): Cents {
  let total = 0;
  for (const v of values) {
    assertCents(v);
    total += v;
  }
  return total;
}
