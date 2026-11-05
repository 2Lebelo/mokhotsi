/**
 * Vectors on the wire (sync contract `vector_f16`): IEEE-754 binary16, little-endian, base64.
 * Half the size of float32; the ranking error is around 1e-4, far below what separates
 * products. On the phone vectors stay float32 (see vector.ts); decoded ones are re-normalised.
 */

import { fromBase64 } from "../lib/hmac.ts";
import { l2Normalize } from "./vector.ts";

const f32 = new Float32Array(1);
const u32 = new Uint32Array(f32.buffer);

/** float → binary16 bits, rounding to nearest. */
export function toHalf(value: number): number {
  f32[0] = value;
  const bits = u32[0];
  const sign = (bits >>> 16) & 0x8000;
  const exponent = (bits >>> 23) & 0xff;
  let mantissa = bits & 0x7fffff;
  if (exponent === 0xff) return sign | 0x7c00 | (mantissa ? 0x200 : 0);
  const e = exponent - 127 + 15;
  if (e >= 0x1f) return sign | 0x7c00;
  if (e <= 0) {
    if (e < -10) return sign;
    mantissa = (mantissa | 0x800000) >> (1 - e);
    return sign | ((mantissa + 0x1000) >> 13);
  }
  // A carry out of the mantissa correctly bumps the exponent.
  return (sign | (e << 10) | (mantissa >> 13)) + ((mantissa >> 12) & 1);
}

export function fromHalf(half: number): number {
  const sign = half & 0x8000 ? -1 : 1;
  const exponent = (half >> 10) & 0x1f;
  const mantissa = half & 0x3ff;
  if (exponent === 0) return sign * mantissa * 2 ** -24;
  if (exponent === 0x1f) return mantissa ? NaN : sign * Infinity;
  return sign * (1 + mantissa / 1024) * 2 ** (exponent - 15);
}

const BASE64 =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

function toBase64(bytes: Uint8Array): string {
  let out = "";
  for (let i = 0; i < bytes.length; i += 3) {
    const n = (bytes[i] << 16) | ((bytes[i + 1] ?? 0) << 8) | (bytes[i + 2] ?? 0);
    out += BASE64[(n >> 18) & 63] + BASE64[(n >> 12) & 63];
    out += i + 1 < bytes.length ? BASE64[(n >> 6) & 63] : "=";
    out += i + 2 < bytes.length ? BASE64[n & 63] : "=";
  }
  return out;
}

export function encodeF16(vector: Float32Array): string {
  const bytes = new Uint8Array(vector.length * 2);
  const view = new DataView(bytes.buffer);
  for (let i = 0; i < vector.length; i++)
    view.setUint16(i * 2, toHalf(vector[i]), true);
  return toBase64(bytes);
}

/** The vector of `dim` values, re-normalised; throws if the length does not match. */
export function decodeF16(base64: string, dim: number): Float32Array {
  const bytes = fromBase64(base64);
  if (bytes.byteLength !== dim * 2)
    throw new Error(`A vector should have ${dim} values.`);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const vector = new Float32Array(dim);
  for (let i = 0; i < dim; i++)
    vector[i] = fromHalf(view.getUint16(i * 2, true));
  return l2Normalize(vector);
}
