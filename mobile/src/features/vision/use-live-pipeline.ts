import { useEffect, useMemo, useRef, useState } from "react";
import { useFrameOutput, type Frame } from "react-native-vision-camera";
import {
  createResizer,
  type Resizer,
  type ResizerOptions,
} from "react-native-vision-camera-resizer";
import {
  createSynchronizable,
  scheduleOnRN,
  type Synchronizable,
} from "react-native-worklets";

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
import { DEBUG_VISION, MANIFEST, PIPELINE } from "@/features/vision/config";
import { disposeQuietly, retireWhenIdle } from "@/features/vision/retire";
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
  /**
   * The phone cannot run this pixel format (no frame has been processed yet): the
   * caller should step down to the next camera mode rather than show an error.
   */
  onUnsupported: (message: string) => void;
};

/** "native": the camera's own format (PRIVATE GPU buffers on Android); "yuv": YUV 4:2:0. */
export type LivePixelFormat = "native" | "yuv";

type LoopState = {
  paused: boolean;
  /** The pipeline is shutting down: no new frame may start (see useResizers). */
  closed: boolean;
  /** A frame is using the resizers right now; they are freed only once it is false. */
  busy: boolean;
  /** A frame has gone through the whole detector path: later errors are real errors. */
  proven: boolean;
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

type Resizers = { detector: Resizer; crop: Resizer };

/**
 * Creates both resizers for the lifetime of the component and frees their GPU pools
 * after. The camera thread may be mid-frame when the component unmounts, and freeing
 * a resizer under it throws ("Previous GPUFrame is still active") or worse, so cleanup
 * closes the loop to new frames first and frees the resizers once the last one is done.
 */
function useResizers(
  loop: Synchronizable<LoopState>,
  onUnsupported: (message: string) => void,
): Resizers | null {
  const [resizers, setResizers] = useState<Resizers | null>(null);
  useEffect(() => {
    let created: Resizer[] = [];
    let cancelled = false;
    void Promise.allSettled([
      createResizer(DETECTOR_RESIZE),
      createResizer(CROP_SOURCE_RESIZE),
    ]).then(([detector, crop]) => {
      if (
        !cancelled &&
        detector.status === "fulfilled" &&
        crop.status === "fulfilled"
      ) {
        created = [detector.value, crop.value];
        setResizers({ detector: detector.value, crop: crop.value });
        return;
      }
      // No frame has seen these yet, so they can be freed straight away.
      for (const result of [detector, crop])
        if (result.status === "fulfilled") disposeQuietly(result.value);
      const failure = [detector, crop].find((r) => r.status === "rejected");
      // Without a resizer no frame can run, so a failure means "unsupported".
      if (!cancelled && failure)
        onUnsupported(`GPU resizer unavailable: ${String(failure.reason)}`);
    });
    return () => {
      cancelled = true;
      // After this returns no frame can claim the resizers (see onFrame).
      loop.setBlocking((previous) => ({ ...previous, closed: true }));
      retireWhenIdle(() => loop.getBlocking().busy, created, {
        onGiveUp: () => {
          if (__DEV__)
            console.log(
              "[vision] a frame never finished; the resizers are left to the garbage collector",
            );
        },
      });
    };
    // loop is per component; onUnsupported is stable (see useLivePipeline).
  }, [loop, onUnsupported]);
  return resizers;
}

/**
 * The live recognition loop for a VisionCamera frame output. Runs entirely on the
 * camera thread: GPU resize → detector (throttled to `max_fps`) → stability →
 * crop → embedder (throttled to `max_per_second`). Frames arriving while it is
 * busy are dropped by the camera. Only small results cross to the JS thread.
 * The iOS resizer needs "yuv"; Android takes either (see camera-ladder for the choice).
 */
export function useLivePipeline(
  models: VisionModels,
  pixelFormat: LivePixelFormat,
  callbacks: LiveCallbacks,
) {
  // Stable functions for the worklet to call back into, reading the latest props.
  const latest = useRef(callbacks);
  useEffect(() => {
    latest.current = callbacks;
  });
  // Results the camera thread queued before unmounting must not reach the screen
  // (e.g. a stale box from the camera mode just stepped down from).
  const open = useRef(true);
  useEffect(() => {
    open.current = true;
    return () => {
      open.current = false;
    };
  }, []);
  const deliver = useMemo(
    () => ({
      detection: (d: LiveDetection) => {
        if (!open.current) return;
        if (DEBUG_VISION)
          console.log(
            `[vision] detection score ${d.score?.toFixed(3) ?? "none"} · box ${d.box ? "shown" : "hidden"} · ${d.latencyMs} ms`,
          );
        latest.current.onDetection(d);
      },
      view: (v: EmbeddedView) => {
        if (open.current) latest.current.onView(v);
      },
      error: (m: string) => {
        if (open.current) latest.current.onError(m);
      },
      unsupported: (m: string) => {
        if (open.current) latest.current.onUnsupported(m);
      },
    }),
    [],
  );

  const loop = useMemo(
    () =>
      createSynchronizable<LoopState>({
        paused: false,
        closed: false,
        busy: false,
        proven: false,
        shown: false,
        lastDetectAt: 0,
        lastEmbedAt: 0,
        stability: UNSTABLE,
      }),
    [],
  );
  const resizers = useResizers(loop, deliver.unsupported);
  const detectorResizer = resizers?.detector ?? null;
  const cropResizer = resizers?.crop ?? null;

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
      let claimed = false;
      try {
        if (!detectorResizer || !cropResizer) return;
        const state = loop.getDirty();
        const now = Date.now();
        if (
          state.closed ||
          state.paused ||
          now - state.lastDetectAt < detectEveryMs
        )
          return;
        // Claimed under the loop's lock: once the pipeline is closed no frame starts,
        // and cleanup waits for a claimed one before freeing the resizers.
        loop.setBlocking((previous) => {
          if (previous.closed) return previous;
          claimed = true;
          return { ...previous, busy: true };
        });
        if (!claimed) return;

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
          proven: true,
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
        const { proven, closed } = loop.getDirty();
        loop.setBlocking((previous) => ({ ...previous, paused: true }));
        // A failure while shutting down is not the phone's or the cashier's problem.
        if (!closed)
          scheduleOnRN(
            proven ? deliver.error : deliver.unsupported,
            error instanceof Error ? error.message : String(error),
          );
      } finally {
        if (claimed)
          loop.setBlocking((previous) => ({ ...previous, busy: false }));
        frame.dispose();
      }
    };
  }, [detector, embedder, detectorResizer, cropResizer, loop, deliver]);

  const frameOutput = useFrameOutput({
    pixelFormat,
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
