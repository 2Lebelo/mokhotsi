import type { TfliteModel } from 'react-native-fast-tflite';
import type { Frame } from 'react-native-vision-camera';
import type { Resizer, ResizerOptions } from 'react-native-vision-camera-resizer';

import type { DetectorSpec } from './manifest';
import type { Box } from './types';

/** Everything `detect` needs, created once on the JS thread and captured by the frame worklet. */
export interface DetectorContext {
  model: TfliteModel;
  /** GPU resizer configured by `detectorResizerOptions(spec)`. */
  resizer: Resizer;
  spec: DetectorSpec;
  /** Output rows (4 + classes), read once from model.outputs so the frame loop does not cross JSI. */
  channels: number;
}

/**
 * Resizer config that produces exactly the detector's input tensor: RGB in [0, 1], centre-square crop
 * ('cover'), planar for NCHW models. The GPU pass also applies frame.orientation, so the crop is upright.
 */
export function detectorResizerOptions(spec: DetectorSpec): ResizerOptions {
  const [height, width] = spec.input;
  return {
    width,
    height,
    channelOrder: 'rgb',
    dataType: 'float32',
    scaleMode: 'cover',
    pixelLayout: spec.layout === 'nchw' ? 'planar' : 'interleaved',
  };
}

/**
 * Check the loaded model against the manifest before it sees a frame. A mismatch would otherwise
 * run silently and return garbage boxes. Throws with the actual shapes; returns the output channel count.
 */
export function checkDetectorIO(model: Pick<TfliteModel, 'inputs' | 'outputs'>, spec: DetectorSpec): number {
  const [h, w, c] = spec.input;
  const expectedIn = spec.layout === 'nchw' ? [1, c, h, w] : [1, h, w, c];
  const input = model.inputs[0];
  const output = model.outputs[0];
  const fmt = (shape: readonly number[] | undefined) => `[${(shape ?? []).join(', ')}]`;
  if (model.inputs.length !== 1 || !input || fmt(input.shape) !== fmt(expectedIn)) {
    throw new Error(`Detector input is ${fmt(input?.shape)}, manifest expects ${fmt(expectedIn)}`);
  }
  if (input.dataType !== spec.dtype) {
    throw new Error(`Detector input dtype is ${input.dataType}, manifest expects ${spec.dtype}`);
  }
  // Ultralytics YOLOv8 (non-end2end): [1, 4 + classes, anchors], channel-major, float32.
  const shape = output?.shape ?? [];
  if (
    model.outputs.length !== 1 ||
    output?.dataType !== 'float32' ||
    shape.length !== 3 ||
    shape[0] !== 1 ||
    shape[1]! < 5 ||
    shape[2]! <= shape[1]!
  ) {
    throw new Error(
      `Detector output is ${fmt(shape)} ${output?.dataType}, expected [1, 4 + classes, anchors] float32`,
    );
  }
  return shape[1]!;
}

/**
 * Stage 1: find the single main product in a camera frame (YOLOv8n).
 * Runs on the frame-output worklet thread; never call it from the JS thread.
 * Returns the highest-scoring box above `spec.score_threshold`, or null.
 */
export function detect(frame: Frame, ctx: DetectorContext): Box | null {
  'worklet';
  const resized = ctx.resizer.resize(frame);
  try {
    const outputs = ctx.model.runSync([resized.getPixelBuffer()]);
    return decodeBest(new Float32Array(outputs[0]!), ctx.channels, ctx.spec.score_threshold);
  } finally {
    // The resizer's buffer pool stalls the pipeline if GPU frames are not returned.
    resized.dispose();
  }
}

/**
 * Best box in a YOLOv8 output tensor [1, channels, N], channel-major: rows cx, cy, w, h, then one score
 * row per class, coordinates normalised to [0, 1] of the model input. Only the top box is needed, and
 * the top box after NMS is always the raw arg-max, so no NMS. Allocation-free apart from the result.
 */
export function decodeBest(out: Float32Array, channels: number, threshold: number): Box | null {
  'worklet';
  const n = out.length / channels;
  let best = -1;
  let bestScore = threshold;
  for (let k = 4; k < channels; k++) {
    const row = k * n;
    for (let i = 0; i < n; i++) {
      const s = out[row + i]!;
      if (s > bestScore) {
        bestScore = s;
        best = i;
      }
    }
  }
  if (best < 0) return null;
  const cx = out[best]!;
  const cy = out[n + best]!;
  const hw = out[2 * n + best]! / 2;
  const hh = out[3 * n + best]! / 2;
  const x = Math.max(0, cx - hw);
  const y = Math.max(0, cy - hh);
  return {
    x,
    y,
    width: Math.max(0, Math.min(1, cx + hw) - x),
    height: Math.max(0, Math.min(1, cy + hh) - y),
    score: bestScore,
  };
}
