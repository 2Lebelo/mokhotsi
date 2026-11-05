/**
 * HMAC-SHA256 (RFC 2104) over an injected SHA-256, so the same code runs on the phone
 * (expo-crypto's digest) and in node tests (node:crypto). expo-crypto has no HMAC of its own.
 */

export type Sha256 = (data: Uint8Array) => Promise<Uint8Array>;

const BLOCK_SIZE = 64;

function concat(a: Uint8Array, b: Uint8Array): Uint8Array {
  const out = new Uint8Array(a.length + b.length);
  out.set(a, 0);
  out.set(b, a.length);
  return out;
}

export async function hmacSha256(
  key: Uint8Array,
  message: Uint8Array,
  sha256: Sha256,
): Promise<Uint8Array> {
  const block = new Uint8Array(BLOCK_SIZE);
  block.set(key.length > BLOCK_SIZE ? await sha256(key) : key);
  const inner = block.map((byte) => byte ^ 0x36);
  const outer = block.map((byte) => byte ^ 0x5c);
  return sha256(concat(outer, await sha256(concat(inner, message))));
}

export function utf8(text: string): Uint8Array {
  return new TextEncoder().encode(text);
}

export function toHex(bytes: Uint8Array): string {
  let out = "";
  for (const byte of bytes) out += byte.toString(16).padStart(2, "0");
  return out;
}

const BASE64 =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

/** Standard base64 (as the API sends keys); padding optional. */
export function fromBase64(text: string): Uint8Array {
  const clean = text.replace(/=+$/, "");
  const out = new Uint8Array(Math.floor((clean.length * 3) / 4));
  let bits = 0;
  let value = 0;
  let index = 0;
  for (const char of clean) {
    const digit = BASE64.indexOf(char);
    if (digit < 0) throw new Error("Invalid base64 text.");
    value = (value << 6) | digit;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out[index++] = (value >> bits) & 0xff;
    }
  }
  return out;
}
