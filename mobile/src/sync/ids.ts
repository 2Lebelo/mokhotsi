import { toHex, utf8, type Sha256 } from "../lib/hmac.ts";

/**
 * The id of a view derived from an image: the same on every phone for the same model, image
 * and crop. When the model changes, each phone re-derives its views from the synced images;
 * equal ids let the server keep one copy instead of one per phone.
 */
export async function derivedViewId(
  sha256: Sha256,
  modelVersion: string,
  imageSha256: string,
  index: number,
): Promise<string> {
  const digest = await sha256(utf8(`view|${modelVersion}|${imageSha256}|${index}`));
  return uuidFrom(digest);
}

/** A version-8 (custom) UUID from the first 16 bytes of a digest (RFC 9562). */
export function uuidFrom(digest: Uint8Array): string {
  const bytes = digest.slice(0, 16);
  bytes[6] = (bytes[6] & 0x0f) | 0x80;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = toHex(bytes);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
