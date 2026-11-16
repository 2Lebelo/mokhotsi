import type { ScoredBox } from "@/ml/geometry";

/**
 * Where an embedded view's time went, in milliseconds (see ml/clock). Optional and only
 * read by the evaluation screen; the till ignores it.
 */
export type ViewTiming = {
  /** Live: crop-source resize + sampling the embedder input. Still: centre square + resize. */
  cropMs?: number;
  /** Embedder inference. */
  embedMs?: number;
  /** Still only: detector inference on the captured photo. */
  detectMs?: number;
  /** Still only: taking the photo. */
  captureMs?: number;
  /** Still only: decoding and rotating the photo upright. */
  decodeMs?: number;
};

/** One embedded view of an item, from the live camera or a still image. */
export type EmbeddedView = {
  /** L2-normalised. */
  vector: Float32Array;
  /** Where the item was found in the model square; null when the whole image was used. */
  box: ScoredBox | null;
  /** The exact pixels the embedder saw, as size × size RGBX bytes, for saving. */
  crop: { rgbx: Uint8Array; size: number };
  timing?: ViewTiming;
};
