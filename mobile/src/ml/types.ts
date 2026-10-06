/**
 * Shared ML types. src/ml/ is framework-free: no React, no database, no app state.
 * Anything that runs per camera frame must be a worklet (`'worklet'` directive) and
 * allocation-free in steady state.
 */

/** Detection box in normalised [0, 1] coordinates of the analysed frame. */
export interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
  /** Detector confidence in [0, 1]. */
  score: number;
}

/** Interleaved (NHWC) RGB float32 image. */
export interface RgbBuffer {
  data: Float32Array;
  width: number;
  height: number;
}

export interface Match {
  productId: string;
  /** Cosine similarity in [-1, 1]; vectors are L2-normalised so this is a dot product. */
  score: number;
}

export type TensorShape = readonly [height: number, width: number, channels: number];
