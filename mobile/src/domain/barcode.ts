// Retail product symbologies only. QR and 2D codes are left out on purpose:
// groceries don't use them, and decoding fewer formats means fewer false reads.
export const RETAIL_SYMBOLOGIES = [
  "ean13",
  "ean8",
  "upc_a",
  "upc_e",
  "code128",
  "code39",
  "itf14",
] as const;

export const MAX_BARCODE_LENGTH = 64;

/**
 * The one canonical form for every barcode that is saved or looked up.
 * A UPC-A code is an EAN-13 code with a leading zero, and scanners report the same
 * pack either way, so 12-digit numeric codes are stored in their 13-digit form.
 */
export function normalizeBarcode(
  raw: string | null | undefined,
): string | null {
  const code = raw?.replace(/\s+/g, "") ?? "";
  if (!code) return null;
  return /^\d{12}$/.test(code) ? `0${code}` : code;
}

export function assertValidBarcode(code: string): void {
  if (code.length > MAX_BARCODE_LENGTH)
    throw new Error(
      `A barcode can have at most ${MAX_BARCODE_LENGTH} characters.`,
    );
  if (!/^[\x21-\x7E]+$/.test(code))
    throw new Error("A barcode can only contain letters, digits, and symbols.");
}
