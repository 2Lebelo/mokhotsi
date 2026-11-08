import Constants from "expo-constants";
import { randomUUID } from "expo-crypto";
import * as Device from "expo-device";
import { useCallback, useEffect, useRef, useState } from "react";
import { Platform } from "react-native";

import { useShop } from "@/db/ShopProvider";
import type { ShopStore } from "@/db/store";
import { nowMs } from "@/ml/clock";
import { MatchVoter } from "@/ml/voter";
import { EVALUATION } from "@/features/evaluation/config";
import {
  newRun,
  nextTrialIndex,
  withoutTrial,
  withTrial,
  type EvaluationRun,
  type RunContext,
} from "@/features/evaluation/run";
import { saveRun } from "@/features/evaluation/storage";
import {
  TrialRecorder,
  type TrialConditions,
  type TrialRecord,
  type TrialTruth,
} from "@/features/evaluation/trial";
import type { CameraMode } from "@/features/vision/camera-ladder";
import { MANIFEST, PIPELINE } from "@/features/vision/config";
import type { EmbeddedView } from "@/features/vision/types";
import type { LiveDetection } from "@/features/vision/use-live-pipeline";
import { vision, type VisionModels } from "@/features/vision/vision-service";

export type EnrolledProduct = { productId: string; name: string; views: number };

/** Products with stored views for the bundled embedder, most views first. */
export function enrolledProducts(store: ShopStore): EnrolledProduct[] {
  const counts = store.embeddings.countsByProduct(MANIFEST.embedder.model_version);
  return [...counts]
    .map(([productId, views]) => ({
      productId,
      name: store.catalogue.product(productId)?.name ?? "Deleted product",
      views,
    }))
    .sort((a, b) => b.views - a.views || a.name.localeCompare(b.name));
}

/** What the run was measured on: phone, build, models, thresholds and the shop's index. */
export function runContext(
  models: VisionModels,
  enrolled: EnrolledProduct[],
  indexViews: number,
): RunContext {
  return {
    device: {
      model: Device.modelName ?? "unknown",
      manufacturer: Device.manufacturer ?? "unknown",
      os: Platform.OS,
      osVersion: Device.osVersion ?? "unknown",
      memoryBytes: Device.totalMemory ?? null,
      appVersion: Constants.expoConfig?.version ?? "unknown",
      build: __DEV__ ? "development" : "release",
    },
    accelerator: models.accelerator,
    models: {
      detector: MANIFEST.detector.model_version,
      embedder: MANIFEST.embedder.model_version,
    },
    thresholds: {
      detectorShow: MANIFEST.detector.show_threshold,
      detectorKeep: MANIFEST.detector.keep_threshold,
      accept: MANIFEST.matching.accept_threshold,
      margin: MANIFEST.matching.margin,
      topK: MANIFEST.matching.top_k,
      voterWindow: EVALUATION.voterWindow,
      voterNeeded: EVALUATION.voterNeeded,
    },
    pipeline: {
      detectorMaxFps: MANIFEST.detector.max_fps,
      embedderMaxPerSecond: MANIFEST.embedder.max_per_second,
      stableFrames: PIPELINE.stability.frames,
      cropPad: PIPELINE.cropPad,
      trialTimeoutMs: EVALUATION.trialTimeoutMs,
    },
    index: { views: indexViews, products: enrolled.length },
    enrolled,
  };
}

export function createRun(name: string, context: RunContext): EvaluationRun {
  const run = newRun(randomUUID(), name.trim(), context, new Date().toISOString());
  saveRun(run);
  return run;
}

type Active = { recorder: TrialRecorder; voter: MatchVoter; still: boolean };

/**
 * Runs trials against the till's own recognition: the same camera, index, top-k and voter as
 * useIdentify, but nothing is learnt, added to the cart, or beeped. A trial ends on a lock,
 * after a still photo, or at the time limit; the researcher then keeps or discards it.
 */
export function useEvaluationTrials(
  initial: EvaluationRun,
  mode: CameraMode,
  context: () => RunContext,
) {
  const { store } = useShop();
  const [run, setRun] = useState(initial);
  const [running, setRunning] = useState(false);
  const [pending, setPending] = useState<TrialRecord | null>(null);
  const active = useRef<Active | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const index = vision.vectorIndex(store);

  const clearTimer = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
  };
  useEffect(() => clearTimer, []);

  const finish = useCallback((fallback: "timeout" | "rejected") => {
    const current = active.current;
    if (!current) return;
    active.current = null;
    clearTimer();
    setRunning(false);
    setPending(current.recorder.finish(fallback, nowMs()));
  }, []);

  function start(truth: TrialTruth, conditions: TrialConditions) {
    if (active.current || pending) return;
    const still = mode === "still";
    active.current = {
      recorder: new TrialRecorder({
        index: nextTrialIndex(run),
        startedAt: new Date().toISOString(),
        t0: nowMs(),
        cameraMode: mode,
        truth,
        conditions,
      }),
      // A still photo is one view, so it must win on its own (window 1, needed 1).
      voter: still
        ? new MatchVoter(MANIFEST.matching, 1, 1)
        : new MatchVoter(
            MANIFEST.matching,
            EVALUATION.voterWindow,
            EVALUATION.voterNeeded,
          ),
      still,
    };
    setRunning(true);
    if (!still)
      timer.current = setTimeout(() => finish("timeout"), EVALUATION.trialTimeoutMs);
  }

  function onDetection(detection: LiveDetection) {
    active.current?.recorder.detected(detection, nowMs());
  }

  function onView(view: EmbeddedView) {
    const current = active.current;
    if (!current) return;
    const arrived = nowMs();
    const ranking = index.topK(view.vector, MANIFEST.matching.top_k);
    const matchMs = nowMs() - arrived;
    const locked = current.voter.push(ranking);
    current.recorder.viewed(view, ranking, matchMs, locked, nowMs());
    if (locked || current.still) finish("rejected");
  }

  /** Stops a running trial without recording it. */
  function abort() {
    active.current = null;
    clearTimer();
    setRunning(false);
  }

  function keep() {
    if (!pending) return;
    const next = withTrial(run, pending, context(), new Date().toISOString());
    saveRun(next);
    setRun(next);
    setPending(null);
  }

  function discard() {
    setPending(null);
  }

  function removeTrial(trialIndex: number) {
    const next = withoutTrial(run, trialIndex, new Date().toISOString());
    saveRun(next);
    setRun(next);
  }

  function replaceRun(next: EvaluationRun) {
    saveRun(next);
    setRun(next);
  }

  return {
    run,
    running,
    pending,
    start,
    abort,
    keep,
    discard,
    removeTrial,
    replaceRun,
    onDetection,
    onView,
    onError: abort,
  };
}
