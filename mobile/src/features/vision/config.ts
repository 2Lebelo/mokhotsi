import manifestJson from "@/assets/models/manifest.json";
import { parseManifest } from "@/ml/manifest";
import { DEFAULT_STABILITY, type StabilityOptions } from "@/ml/stability";

/** Model contract: shapes, ranges, thresholds, versions. Validated at startup. */
export const MANIFEST = parseManifest(manifestJson);

// Metro needs static requires, so bundled model files are listed here and looked
// up by the manifest's file names. A manifest naming a missing file fails loudly.
/* eslint-disable @typescript-eslint/no-require-imports -- Metro bundles assets only via static require(). */
export const MODEL_FILES: Readonly<Record<string, number>> = {
  "detector.tflite": require("@/assets/models/detector.tflite"),
  "embedder.tflite": require("@/assets/models/embedder.tflite"),
};
/* eslint-enable @typescript-eslint/no-require-imports */

/** App-side pipeline behaviour (not properties of the models). */
export const PIPELINE = {
  /** Square size of the crop source both pipelines sample embedder input from. */
  cropSourceSize: 448,
  /** Context added around a detected item before embedding, per side. */
  cropPad: 0.08,
  /**
   * Product photos are embedded once per padding: tight like the live crop, and
   * looser, so an item held nearer or further from the camera still matches.
   */
  photoCropPads: [0.08, 0.25],
  stability: DEFAULT_STABILITY satisfies StabilityOptions,
  /** Seconds without a confident match before hints and "closest matches" appear. */
  hintAfterMs: 6000,
} as const;

export const LEARNING = {
  /** Correction views kept per product (newest first), bounding index growth. */
  maxCorrections: 20,
} as const;

/**
 * Phones (Android `Build.MODEL`, as reported by expo-device's `modelName`) that
 * run the models on the GPU delegate. Every other phone uses the CPU (XNNPACK):
 * it is predictable, has no thread affinity, and low-end GPUs are often slower.
 * Add a model only after measuring it in the identify screen's debug strip.
 */
export const GPU_DEVICE_MODELS: readonly string[] = [];

/** How long the app stays in the background before models are freed. */
export const UNLOAD_AFTER_BACKGROUND_MS = 60_000;
