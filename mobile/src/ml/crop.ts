import type { Box, RgbBuffer } from './types';

/**
 * Crop `box` out of an RGB buffer and resample to size×size×3 (embedder input, 224 for
 * MobileNetV2). Writes into `out` when given so the frame loop does not allocate.
 * Worklet-safe: pure arithmetic on typed arrays.
 */
export function crop(buffer: RgbBuffer, box: Box, size: number, out?: Float32Array): Float32Array {
  'worklet';
  // TODO(feature): bilinear resample of the box region into out (length size*size*3), clamped to bounds, in the embedder's input_range.
  throw new Error(
    `TODO(feature): crop() is not implemented (${buffer.width}x${buffer.height} → ${size}, box ${box.score}, out ${out?.length ?? 0})`,
  );
}
