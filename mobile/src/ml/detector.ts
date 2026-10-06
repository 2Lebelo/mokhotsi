import type { TfliteModel } from 'react-native-fast-tflite';
import type { Frame } from 'react-native-vision-camera';
import type { Resizer } from 'react-native-vision-camera-resizer';

import type { DetectorSpec } from './manifest';
import type { Box } from './types';

/** Everything `detect` needs, created once on the JS thread and captured by the frame worklet. */
export interface DetectorContext {
  model: TfliteModel;
  /** GPU resizer configured to spec.input (640×640, rgb, float32, interleaved). */
  resizer: Resizer;
  spec: DetectorSpec;
}

/**
 * Stage 1: find the single main product in a camera frame (YOLOv8n).
 * Runs on the frame-output worklet thread; never call it from the JS thread.
 * Returns the highest-scoring box above `spec.score_threshold`, or null.
 */
export function detect(frame: Frame, ctx: DetectorContext): Box | null {
  'worklet';
  // TODO(feature): resizer.resize(frame) → getPixelBuffer() → model.runSync([buf]) → decode YOLOv8 output (+NMS) → best box; dispose GPUFrame.
  throw new Error(
    `TODO(feature): detect() is not implemented (frame ${frame.width}x${frame.height}, ${ctx.spec.arch})`,
  );
}
