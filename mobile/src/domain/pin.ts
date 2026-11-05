/**
 * PIN rules, mirroring the API (app/core/credentials.py) so a bad PIN is caught before the
 * request. The server stays the authority.
 */

export const PIN_LENGTH = 5;

export function isPinShaped(pin: string): boolean {
  return pin.length === PIN_LENGTH && /^\d+$/.test(pin);
}

/** Why `pin` cannot be a new PIN, or null when it is acceptable. */
export function pinProblem(pin: string): string | null {
  if (!isPinShaped(pin)) return `The PIN must be exactly ${PIN_LENGTH} digits.`;
  const digits = [...pin].map(Number);
  const steps = new Set(digits.slice(1).map((d, i) => d - digits[i]));
  if (new Set(digits).size === 1 || (steps.size === 1 && (steps.has(1) || steps.has(-1))))
    return "Choose a PIN that is harder to guess than repeated or counting digits.";
  const even = new Set(digits.filter((_, i) => i % 2 === 0));
  const odd = new Set(digits.filter((_, i) => i % 2 === 1));
  if (even.size === 1 && odd.size === 1)
    return "Choose a PIN that is harder to guess than a repeating pair of digits.";
  return null;
}
