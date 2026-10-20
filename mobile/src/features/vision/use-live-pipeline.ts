import { useEffect, useMemo, useRef, useState } from "react";
import { Platform } from "react-native";
import { useFrameOutput, type Frame } from "react-native-vision-camera";
import {
  createResizer,
  type Resizer,
  type ResizerOptions,
} from "react-native-vision-camera-resizer";
import { createSynchronizable, scheduleOnRN } from "react-native-worklets";

import { squareCrop, type ScoredBox } from "@/ml/geometry";
import {
  isStable,
  nextStability,
  UNSTABLE,
  type Stability,
} from "@/ml/stability";
import { pixelSource, sampleToTensor } from "@/ml/tensors";
import { l2Normalize } from "@/ml/vector";
import { decodeBestBox, holdBox } from "@/ml/yolo";
import { MANIFEST, PIPELINE } from "@/features/vision/config";
import type { EmbeddedView } from "@/features/vision/types";
import type { VisionModels } from "@/features/vision/vision-service";

export type LiveDetection = {
  /** The item in the model square (and the square preview), or null. */
  box: ScoredBox | null;
  /** The detector's best score this frame, shown or not (null: no candidates). */
  score: number | null;
  stable: boolean;
  /** Detector time for this frame, including the GPU resize. */
  latencyMs: number;
};

export type LiveCallbacks = {
  onDetection: (detection: LiveDetection) => void;
  /** A held-still item was embedded (at most `max_per_second` times a second). */
  onView: (view: EmbeddedView) => void;
  onError: (message: string) => void;
};

type LoopState = {
  paused: boolean;
  /** Whether a box is on screen, for the show/keep score hysteresis. */
  shown: boolean;
  lastDetectAt: number;
  lastEmbedAt: number;
  stability: Stability;
};

const { detector: DETECTOR, embedder: EMBEDDER } = MANIFEST;

// Resizer A: the detector's exact input tensor, straight from the GPU.
const DETECTOR_RESIZE: ResizerOptions = {
  width: DETECTOR.input[1],
  height: DETECTOR.input[0],
  channelOrder: "rgb",
  dataType: "float32",
  scaleMode: "cover",
  pixelLayout: DETECTOR.layout === "nchw" ? "planar" : "interleaved",
};

// Resizer B: the same square at higher resolution, sampled on the CPU into the
// embedder crop (the resizer cannot crop a region itself). Only used when embedding.
const CROP_SOURCE_RESIZE: ResizerOptions = {
  width: PIPELINE.cropSourceSize,
  height: PIPELINE.cropSourceSize,
  channelOrder: "rgb",
  dataType: "uint8",
  scaleMode: "cover",
  pixelLayout: "interleaved",
};

// The resizer needs YUV on iOS; Android accepts the camera's native format directly.
const PIXEL_FORMAT = Platform.OS === "ios" ? "yuv" : "native";

/** Creates a resizer for the lifetime of the component and frees its GPU pool after. */
function useResizer(
  options: ResizerOptions,
  onError: (message: string) => void,
) {
  const [resizer, setResizer] = useState<Resizer | null>(null);
  useEffect(() => {
    let created: Resizer | null = null;
    let cancelled = false;
    createResizer(options).then(
      (value) => {
        if (cancelled) {
          value.dispose();
          return;
        }
        created = value;
        setResizer(value);
      },
      (error: unknown) => {
        if (!cancelled) onError(`GPU resizer unavailable: ${String(error)}`);
      },
    );
    return () => {
      cancelled = true;
      created?.dispose();
    };
    // Options are module constants; onError is stable (see useLivePipeline).
  }, [options, onError]);
  return resizer;
}

/**
 * The live recognition loop for a VisionCamera frame output. Runs entirely on the
 * camera thread: GPU resize → detector (throttled to `max_fps`) → stability →
 * crop → embedder (throttled to `max_per_second`). Frames arriving while it is
 * busy are dropped by the camera. Only small results cross to the JS thread.
 */
export function useLivePipeline(
  models: VisionModels,
  callbacks: LiveCallbacks,
) {
  // Stable functions for the worklet to call back into, reading the latest props.
  const latest = useRef(callbacks);
  useEffect(() => {
    latest.current = callbacks;
  });
  const deliver = useMemo(
    () => ({
      detection: (d: LiveDetection) => {
        console.log(
          `[vision] detection score ${d.score?.toFixed(3) ?? "none"} · box ${d.box ? "shown" : "hidden"} · ${d.latencyMs} ms`,
        );
        latest.current.onDetection(d);
      },
      view: (v: EmbeddedView) => latest.current.onView(v),
      error: (m: string) => latest.current.onError(m),
    }),
    [],
  );

  const detectorResizer = useResizer(DETECTOR_RESIZE, deliver.error);
  const cropResizer = useResizer(CROP_SOURCE_RESIZE, deliver.error);
  const loop = useMemo(
    () =>
      createSynchronizable<LoopState>({
        paused: false,
        shown: false,
        lastDetectAt: 0,
        lastEmbedAt: 0,
        stability: UNSTABLE,
      }),
    [],
  );

  const { detector, embedder } = models;
  const onFrame = useMemo(() => {
    const detectEveryMs = 1000 / DETECTOR.max_fps;
    const embedEveryMs = 1000 / EMBEDDER.max_per_second;
    const channels = DETECTOR.output[0];
    const show = DETECTOR.show_threshold;
    const keep = DETECTOR.keep_threshold;
    const size = EMBEDDER.input[0];
    const range = EMBEDDER.input_range;
    const layout = EMBEDDER.layout;
    const pad = PIPELINE.cropPad;
    const stabilityOptions = PIPELINE.stability;

    return (frame: Frame) => {
      "worklet";
      try {
        if (!detectorResizer || !cropResizer) return;
        const state = loop.getDirty();
        const now = Date.now();
        if (state.paused || now - state.lastDetectAt < detectEveryMs) return;

        const resized = detectorResizer.resize(frame);
        let best: ScoredBox | null;
        try {
          const [output] = detector.runSync([resized.getPixelBuffer()]);
          // Threshold 0: always get the best candidate, so its score can be logged.
          best = decodeBestBox(new Float32Array(output), channels, 0);
        } finally {
          resized.dispose();
        }
        const box = holdBox(best, state.shown, show, keep);
        const stability = nextStability(state.stability, box, stabilityOptions);
        const stable = isStable(stability, stabilityOptions);

        let view: EmbeddedView | null = null;
        if (
          stable &&
          stability.box &&
          now - state.lastEmbedAt >= embedEveryMs
        ) {
          const input = new Float32Array(size * size * 3);
          const rgbx = new Uint8Array(size * size * 4);
          const source = cropResizer.resize(frame);
          try {
            const pixels = pixelSource(
              source.getPixelBuffer(),
              source.width,
              source.height,
              "RGB",
            );
            sampleToTensor(
              pixels,
              squareCrop(stability.box, pad),
              size,
              layout,
              range,
              input,
              rgbx,
            );
          } finally {
            source.dispose();
          }
          const [output] = embedder.runSync([input.buffer]);
          view = {
            vector: l2Normalize(new Float32Array(output)),
            box: stability.box,
            crop: { rgbx, size },
          };
        }

        loop.setBlocking((previous) => ({
          ...previous,
          shown: box !== null,
          lastDetectAt: now,
          lastEmbedAt: view ? now : previous.lastEmbedAt,
          stability,
        }));
        scheduleOnRN(deliver.detection, {
          box,
          score: best ? best.score : null,
          stable,
          latencyMs: Date.now() - now,
        });
        if (view) scheduleOnRN(deliver.view, view);
      } catch (error) {
        // Stop instead of reporting the same failure on every frame.
        loop.setBlocking((previous) => ({ ...previous, paused: true }));
        scheduleOnRN(
          deliver.error,
          error instanceof Error ? error.message : String(error),
        );
      } finally {
        frame.dispose();
      }
    };
  }, [detector, embedder, detectorResizer, cropResizer, loop, deliver]);

  const frameOutput = useFrameOutput({
    pixelFormat: PIXEL_FORMAT,
    // The models see at most 448 px; full-resolution buffers only cost bandwidth.
    enablePreviewSizedOutputBuffers: true,
    dropFramesWhileBusy: true,
    onFrame,
  });

  const controls = useMemo(
    () => ({
      /** Pauses or resumes processing; resuming starts a fresh stability streak. */
      setPaused(paused: boolean) {
        loop.setBlocking((previous) => ({
          ...previous,
          paused,
          shown: false,
          stability: UNSTABLE,
        }));
      },
    }),
    [loop],
  );

  return {
    frameOutput,
    ready: detectorResizer !== null && cropResizer !== null,
    ...controls,
  };
}
