import {
  loadTensorflowModel,
  type TensorflowModelDelegate,
  type TfliteModel,
} from 'react-native-fast-tflite';

import { ModelsUnavailableError } from '@/lib/errors';

import type { ModelManifest } from './manifest';
import { MODEL_ASSETS } from './modelAssets.generated';

export interface LoadedModels {
  detector: TfliteModel;
  embedder: TfliteModel;
}

/** File names from the manifest that are not bundled (empty when all are present). */
export function missingModelFiles(manifest: ModelManifest): string[] {
  return [manifest.detector.file, manifest.embedder.file].filter((f) => MODEL_ASSETS[f] === undefined);
}

function assetFor(file: string): number {
  const asset = MODEL_ASSETS[file];
  if (asset === undefined) throw new ModelsUnavailableError([file]);
  return asset;
}

/**
 * Load the detector on its own (stage 1 works before the embedder exists). Tries each delegate list in
 * order, e.g. [['android-gpu'], []] = GPU, then CPU when the delegate cannot load the model on this device.
 * Throws ModelsUnavailableError when detector.tflite is not bundled.
 */
export async function loadDetector(
  manifest: ModelManifest,
  delegateChain: readonly TensorflowModelDelegate[][],
): Promise<TfliteModel> {
  const asset = assetFor(manifest.detector.file);
  let lastError: unknown = new Error('loadDetector: empty delegate chain');
  for (const delegates of delegateChain) {
    try {
      return await loadTensorflowModel(asset, delegates);
    } catch (e) {
      lastError = e;
    }
  }
  throw lastError;
}

/**
 * Load both models. Throws ModelsUnavailableError (never crashes the app) when a .tflite file
 * listed in the manifest is missing from assets/models/.
 */
export async function loadModels(
  manifest: ModelManifest,
  delegates: TensorflowModelDelegate[] = [],
): Promise<LoadedModels> {
  const missing = missingModelFiles(manifest);
  if (missing.length > 0) throw new ModelsUnavailableError(missing);
  // TODO(feature): pick delegates per device ('android-gpu' → 'nnapi' → CPU) and fall back on load failure.
  const [detector, embedder] = await Promise.all([
    loadTensorflowModel(assetFor(manifest.detector.file), delegates),
    loadTensorflowModel(assetFor(manifest.embedder.file), delegates),
  ]);
  return { detector, embedder };
}
