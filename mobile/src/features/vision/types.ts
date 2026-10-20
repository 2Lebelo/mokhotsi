import type { ScoredBox } from "@/ml/geometry";

/** One embedded view of an item, from the live camera or a still image. */
export type EmbeddedView = {
  /** L2-normalised. */
  vector: Float32Array;
  /** Where the item was found in the model square; null when the whole image was used. */
  box: ScoredBox | null;
  /** The exact pixels the embedder saw, as size × size RGBX bytes, for saving. */
  crop: { rgbx: Uint8Array; size: number };
};
