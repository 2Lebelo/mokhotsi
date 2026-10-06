import type { TfliteModel } from 'react-native-fast-tflite';

import type { EmbedderSpec } from './manifest';

export interface EmbedderContext {
  model: TfliteModel;
  spec: EmbedderSpec;
}

/**
 * Stage 2: turn a size×size×3 crop into an L2-normalised `spec.dim`-length vector
 * (MobileNetV2, global-average-pooled, no classifier head).
 * Worklet-safe; also used on the JS thread during enrolment.
 */
export function embed(input: Float32Array, ctx: EmbedderContext): Float32Array {
  'worklet';
  // TODO(feature): model.runSync([input.buffer]) → Float32Array(dim) → L2-normalise in place → return.
  throw new Error(`TODO(feature): embed() is not implemented (input ${input.length}, dim ${ctx.spec.dim})`);
}
