/** Scales a vector to unit length in place, so cosine similarity is a dot product. */
export function l2Normalize(vector: Float32Array): Float32Array {
  "worklet";
  let sum = 0;
  for (let i = 0; i < vector.length; i++) sum += vector[i] * vector[i];
  const norm = Math.sqrt(sum);
  if (norm > 0) for (let i = 0; i < vector.length; i++) vector[i] /= norm;
  return vector;
}

export function dot(a: Float32Array, b: Float32Array): number {
  "worklet";
  let sum = 0;
  for (let i = 0; i < a.length; i++) sum += a[i] * b[i];
  return sum;
}

/** Little-endian float32 bytes for SQLite BLOB storage, independent of platform. */
export function toBlob(vector: Float32Array): Uint8Array {
  const bytes = new Uint8Array(vector.length * 4);
  const view = new DataView(bytes.buffer);
  for (let i = 0; i < vector.length; i++)
    view.setFloat32(i * 4, vector[i], true);
  return bytes;
}

export function fromBlob(blob: Uint8Array): Float32Array {
  if (blob.byteLength % 4 !== 0)
    throw new Error("A stored vector has a corrupt length.");
  const view = new DataView(blob.buffer, blob.byteOffset, blob.byteLength);
  const vector = new Float32Array(blob.byteLength / 4);
  for (let i = 0; i < vector.length; i++)
    vector[i] = view.getFloat32(i * 4, true);
  return vector;
}
