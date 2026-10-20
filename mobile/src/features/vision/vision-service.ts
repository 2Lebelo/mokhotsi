import * as Device from "expo-device";
import {
  loadTensorflowModel,
  type TensorflowModel,
  type TensorflowModelDelegate,
} from "react-native-fast-tflite";
import { Platform } from "react-native";

import type { ShopStore } from "@/db/store";
import { assertModelIO, inputShape } from "@/ml/manifest";
import { VectorIndex } from "@/ml/vector-index";
import {
  GPU_DEVICE_MODELS,
  MANIFEST,
  MODEL_FILES,
} from "@/features/vision/config";

export type VisionModels = {
  detector: TensorflowModel;
  embedder: TensorflowModel;
  /** "gpu" or "cpu": what the device actually accepted. */
  accelerator: "gpu" | "cpu";
};

// CPU (TFLite's default XNNPACK delegate) unless this phone is listed for the
// GPU; a GPU the delegate cannot use still falls back to the CPU.
const GPU_ENABLED =
  Platform.OS === "android" &&
  GPU_DEVICE_MODELS.includes(Device.modelName ?? "");
const DELEGATE_CHAINS: TensorflowModelDelegate[][] = GPU_ENABLED
  ? [["android-gpu"], []]
  : [[]];

async function loadOne(
  file: string,
): Promise<{ model: TensorflowModel; gpu: boolean }> {
  const source = MODEL_FILES[file];
  if (source === undefined)
    throw new Error(`The model file ${file} is not bundled with the app.`);
  let lastError: unknown;
  for (const delegates of DELEGATE_CHAINS) {
    try {
      return {
        model: await loadTensorflowModel(source, delegates),
        gpu: delegates.length > 0,
      };
    } catch (error) {
      lastError = error;
      if (delegates.length > 0)
        console.warn(
          `[vision] ${file}: ${delegates.join("+")} delegate failed, trying the next option: ${error instanceof Error ? error.message : String(error)}`,
        );
    }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

async function warmUp(model: TensorflowModel, shape: number[]): Promise<void> {
  // The first inference initialises GPU kernels; do it now, off the JS thread.
  const size = shape.reduce((a, b) => a * b, 1);
  await model.run([new Float32Array(size).buffer]);
}

/**
 * Owns the on-device models and the taught-view index for the whole app.
 *
 * - Models load once, on first use, and are validated against the manifest.
 * - The index is rebuilt lazily after any embedding write (`invalidate`).
 * - A camera screen takes a foreground lease; background work never runs a
 *   model at the same time, because an interpreter is not safe to share.
 */
class VisionService {
  private models: Promise<VisionModels> | null = null;
  private index: VectorIndex | null = null;
  private leases = 0;
  private backgroundStep: Promise<void> | null = null;

  load(): Promise<VisionModels> {
    if (!this.models) {
      this.models = (async () => {
        const [detector, embedder] = await Promise.all([
          loadOne(MANIFEST.detector.file),
          loadOne(MANIFEST.embedder.file),
        ]);
        assertModelIO(
          "detector",
          detector.model,
          inputShape(MANIFEST.detector),
          [1, ...MANIFEST.detector.output],
        );
        assertModelIO(
          "embedder",
          embedder.model,
          inputShape(MANIFEST.embedder),
          [1, MANIFEST.embedder.dim],
        );
        await warmUp(detector.model, inputShape(MANIFEST.detector));
        await warmUp(embedder.model, inputShape(MANIFEST.embedder));
        console.log(
          `[vision] models ready on ${Device.modelName ?? "unknown phone"}: detector ${detector.gpu ? "gpu" : "cpu"}, embedder ${embedder.gpu ? "gpu" : "cpu"}`,
        );
        return {
          detector: detector.model,
          embedder: embedder.model,
          accelerator: detector.gpu && embedder.gpu ? "gpu" : "cpu",
        } satisfies VisionModels;
      })();
      // A failed load is not cached, so the next attempt retries.
      this.models.catch(() => {
        this.models = null;
      });
    }
    return this.models;
  }

  /** Frees the models unless a camera screen is using them. */
  async unload(): Promise<void> {
    if (this.leases > 0 || !this.models) return;
    const loading = this.models;
    this.models = null;
    await this.backgroundStep;
    try {
      const { detector, embedder } = await loading;
      detector.dispose();
      embedder.dispose();
    } catch {
      /* Never loaded; nothing to free. */
    }
  }

  /** The taught-view index for the current embedder version. */
  vectorIndex(store: ShopStore): VectorIndex {
    if (!this.index) {
      const rows = store.embeddings.vectors(MANIFEST.embedder.model_version);
      const index = new VectorIndex(
        MANIFEST.embedder.dim,
        Math.max(rows.length, 1),
      );
      for (const row of rows) index.add(row.productId, row.vector);
      this.index = index;
    }
    return this.index;
  }

  invalidate(): void {
    this.index = null;
  }

  /**
   * Called by camera screens. Resolves once any in-flight background inference
   * has finished; the returned function releases the lease.
   */
  async acquireForeground(): Promise<() => void> {
    this.leases++;
    await this.backgroundStep;
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.leases--;
    };
  }

  get inForeground(): boolean {
    return this.leases > 0;
  }

  /** Runs one unit of background work, unless a camera screen holds the models. */
  async runInBackground<T>(work: () => Promise<T>): Promise<T | undefined> {
    if (this.inForeground) return undefined;
    const step = work();
    this.backgroundStep = step.then(
      () => undefined,
      () => undefined,
    );
    try {
      return await step;
    } finally {
      this.backgroundStep = null;
    }
  }
}

export const vision = new VisionService();
