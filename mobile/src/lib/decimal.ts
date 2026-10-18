// Fixed-point helpers shared by prices (2 decimals) and pack sizes (3 decimals).
// Values are parsed with BigInt so typed amounts never pass through a float.

export function parseFixed(value: string, decimals: number): bigint | null {
  const normalized = value.trim().replace(",", ".");
  const fraction = decimals > 0 ? `(\\.\\d{1,${decimals}})?` : "";
  if (!new RegExp(`^\\d+${fraction}$`).test(normalized)) return null;
  const [whole, digits = ""] = normalized.split(".");
  const scale = 10n ** BigInt(decimals);
  return BigInt(whole) * scale + BigInt(digits.padEnd(decimals, "0") || "0");
}

/** Formats a scaled integer without trailing zeros: (2500, 3) → "2.5". */
export function formatFixed(value: number, decimals: number): string {
  const scale = 10 ** decimals;
  const whole = Math.floor(value / scale);
  const fraction = String(value % scale)
    .padStart(decimals, "0")
    .replace(/0+$/, "");
  return fraction ? `${whole}.${fraction}` : String(whole);
}
