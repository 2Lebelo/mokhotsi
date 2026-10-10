import { base64ToBytes, base64ToFloat32, bytesToBase64, float32ToBase64 } from '@/lib/base64';

describe('base64', () => {
  it('matches Node for every padding case', () => {
    for (let length = 0; length < 40; length++) {
      const bytes = Uint8Array.from({ length }, (_, i) => (i * 37 + length) % 256);
      const expected = Buffer.from(bytes).toString('base64');
      expect(bytesToBase64(bytes)).toBe(expected);
      expect(Array.from(base64ToBytes(expected))).toEqual(Array.from(bytes));
    }
  });

  it('round-trips float32 vectors as little-endian bytes (the contract example)', () => {
    expect(float32ToBase64(Float32Array.from([1, 0, 0, 0]))).toBe('AACAPwAAAAAAAAAAAAAAAA==');
    const vector = Float32Array.from([0.5, -0.25, 1e-7, 3.4e38]);
    expect(Array.from(base64ToFloat32(float32ToBase64(vector)))).toEqual(Array.from(vector));
    // Works on a view with an offset into a larger buffer.
    const view = new Float32Array(Float32Array.from([9, 1, 2]).buffer, 4, 2);
    expect(Array.from(base64ToFloat32(float32ToBase64(view)))).toEqual([1, 2]);
  });

  it('rejects malformed input', () => {
    expect(() => base64ToBytes('a')).toThrow(TypeError);
    expect(() => base64ToBytes('ab$d')).toThrow(TypeError);
  });
});
