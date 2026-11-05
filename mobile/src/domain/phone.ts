/**
 * Lesotho phone numbers as owners type them: 8 digits after +266 (the API's
 * app/core/credentials.py checks the same). The prefix is fixed in the field.
 */

export const COUNTRY_CODE = "266";
export const NATIONAL_LENGTH = 8;

/** Digits only, at most 8, dropping a typed +266 / 00266 / leading 0. */
export function phoneDigits(input: string): string {
  let digits = input.replace(/\D/g, "");
  if (digits.startsWith(`00${COUNTRY_CODE}`)) digits = digits.slice(2 + COUNTRY_CODE.length);
  else if (digits.startsWith(COUNTRY_CODE) && digits.length > NATIONAL_LENGTH)
    digits = digits.slice(COUNTRY_CODE.length);
  return digits.replace(/^0+/, "").slice(0, NATIONAL_LENGTH);
}

/** "58123456" → "5812 3456" while typing. */
export function formatPhone(digits: string): string {
  return digits.length > 4 ? `${digits.slice(0, 4)} ${digits.slice(4)}` : digits;
}

export function isPhoneComplete(digits: string): boolean {
  return digits.length === NATIONAL_LENGTH;
}

export function toE164(digits: string): string {
  return `+${COUNTRY_CODE}${digits}`;
}
