export function parsePrice(value: string): number {
  const normalized = value.trim().replace(",", ".");
  if (!/^\d+(\.\d{1,2})?$/.test(normalized)) {
    throw new Error("Enter a price with no more than two decimal places.");
  }
  const [whole, fraction = ""] = normalized.split(".");
  const cents = BigInt(whole) * 100n + BigInt(fraction.padEnd(2, "0"));
  if (cents > BigInt(Number.MAX_SAFE_INTEGER))
    throw new Error("This price is too large.");
  return Number(cents);
}

export function formatMoney(cents: number): string {
  const whole = Math.floor(cents / 100).toLocaleString("en-ZA");
  return `M ${whole}.${String(cents % 100).padStart(2, "0")}`;
}

export function priceInput(cents: number): string {
  return `${Math.floor(cents / 100)}.${String(cents % 100).padStart(2, "0")}`;
}

export function parseStock(value: string): number {
  if (!/^\d+$/.test(value.trim()))
    throw new Error("Enter stock as a whole number, zero or more.");
  const quantity = Number(value.trim());
  if (!Number.isSafeInteger(quantity))
    throw new Error("This stock quantity is too large.");
  return quantity;
}
