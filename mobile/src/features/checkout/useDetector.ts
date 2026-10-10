import { useEffect, useState } from 'react';
import { Platform } from 'react-native';
import type { TensorflowModelDelegate, TfliteModel } from 'react-native-fast-tflite';

import { checkDetectorIO } from '@/ml/detector';
import type { DetectorSpec, ModelManifest } from '@/ml/manifest';
import { loadDetector } from '@/ml/models';

import { useModelStatus } from './useModelStatus';

export type DetectorState =
  | { state: 'unavailable'; message: string }
  | { state: 'loading' }
  | { state: 'ready'; model: TfliteModel; spec: DetectorSpec; channels: number }
  | { state: 'error'; message: string };

type Loaded = Extract<DetectorState, { state: 'ready' | 'error' }>;

let loading: Promise<Loaded> | undefined;

/** GPU first (runs the fp32 model in fp16), then CPU. */
const DELEGATE_CHAIN: TensorflowModelDelegate[][] =
  Platform.OS === 'ios' ? [['core-ml'], []] : [['android-gpu'], []];

async function load(manifest: ModelManifest): Promise<Loaded> {
  const spec = manifest.detector;
  try {
    const model = await loadDetector(manifest, DELEGATE_CHAIN);
    return { state: 'ready', model, spec, channels: checkDetectorIO(model, spec) };
  } catch (e) {
    return { state: 'error', message: e instanceof Error ? e.message : String(e) };
  }
}

/** The stage-1 detector, loaded lazily. Never throws: failures come back as state 'error'. */
export function useDetector(): DetectorState {
  const status = useModelStatus();
  const available = status.state === 'ready' || (status.state === 'missing' && status.detectorAvailable);
  const [state, setState] = useState<DetectorState>(() =>
    available ? { state: 'loading' } : { state: 'unavailable', message: status.message },
  );

  useEffect(() => {
    if (!available) return;
    let cancelled = false;
    // Load + validate once per launch; the sell and debug screens share the same model instance.
    loading ??= load(status.manifest);
    void loading.then((loaded) => {
      if (!cancelled) setState(loaded);
    });
    return () => {
      cancelled = true;
    };
  }, [available, status]);

  return state;
}
