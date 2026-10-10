import { useState } from 'react';

import { loadManifest, type ModelManifest } from '@/ml/manifest';
import { missingModelFiles } from '@/ml/models';

export type ModelStatus =
  | { state: 'ready'; manifest: ModelManifest }
  | {
      state: 'missing';
      manifest: ModelManifest;
      missing: string[];
      /** True when only the embedder is missing: stage 1 (detection) can still run. */
      detectorAvailable: boolean;
      message: string;
    }
  | { state: 'invalid'; message: string };

/** Manifest and bundled files are fixed at build time, so compute once per launch. */
function computeModelStatus(): ModelStatus {
  let manifest: ModelManifest;
  try {
    manifest = loadManifest();
  } catch (e) {
    return { state: 'invalid', message: e instanceof Error ? e.message : String(e) };
  }
  const missing = missingModelFiles(manifest);
  if (missing.length > 0) {
    return {
      state: 'missing',
      manifest,
      missing,
      detectorAvailable: !missing.includes(manifest.detector.file),
      message:
        `Product recognition is unavailable: ${missing.join(', ')} not found in assets/models. ` +
        'Add the exported .tflite files, run `npm run models:sync` and rebuild.',
    };
  }
  return { state: 'ready', manifest };
}

let cached: ModelStatus | undefined;

function getModelStatus(): ModelStatus {
  cached ??= computeModelStatus();
  return cached;
}

/** Checks the manifest and bundled .tflite files without loading the models. */
export function useModelStatus(): ModelStatus {
  const [status] = useState(getModelStatus);
  return status;
}
