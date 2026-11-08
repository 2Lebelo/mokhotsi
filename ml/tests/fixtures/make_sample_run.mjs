// Writes sample_run.json with the app's own TrialRecorder and run helpers, so the Python
// analysis is tested against exactly what the phone exports. Deterministic (seeded).
// Regenerate after changing the run format:  node ml/tests/fixtures/make_sample_run.mjs
import { writeFileSync } from "node:fs";

import { benchmark } from "../../../mobile/src/features/evaluation/benchmark.ts";
import { runToJson } from "../../../mobile/src/features/evaluation/export.ts";
import {
  newRun,
  withBenchmarks,
  withTrial,
} from "../../../mobile/src/features/evaluation/run.ts";
import { TrialRecorder } from "../../../mobile/src/features/evaluation/trial.ts";

let seed = 42;
const random = () => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);
const jitter = (base, spread) => Math.round((base + (random() - 0.5) * spread) * 100) / 100;

const products = [
  { productId: "p-bread", name: "Bread, brown", views: 4 },
  { productId: "p-apples", name: "Apples, loose", views: 4 },
  { productId: "p-maize", name: "Maize meal, 1 kg", views: 2 },
];
const context = {
  device: {
    model: "SM-A045F",
    manufacturer: "samsung",
    os: "android",
    osVersion: "14",
    memoryBytes: 3 * 2 ** 30,
    appVersion: "1.0.0",
    build: "release",
  },
  accelerator: "cpu",
  models: {
    detector: "yolov8n-320-1cls-grocery-ft4@2026-10-19",
    embedder: "mobilenet_v2-imagenet-224-1280@2026-10-10",
  },
  thresholds: {
    detectorShow: 0.6,
    detectorKeep: 0.4,
    accept: 0.6,
    margin: 0.03,
    topK: 3,
    voterWindow: 3,
    voterNeeded: 2,
  },
  pipeline: {
    detectorMaxFps: 8,
    embedderMaxPerSecond: 2,
    stableFrames: 3,
    cropPad: 0.08,
    trialTimeoutMs: 10000,
  },
  index: { views: 10, products: 3 },
  enrolled: products,
};

const box = { x: 0.2, y: 0.2, width: 0.5, height: 0.5, score: 0.85 };
let run = newRun("0f3c9a5e-1111-4222-8333-944445555666", "Fixture", context, "2026-11-07T08:00:00.000Z");

function trial(index, truth, lockTo, conditions) {
  const r = new TrialRecorder({
    index,
    startedAt: `2026-11-07T08:${String(index).padStart(2, "0")}:00.000Z`,
    t0: 0,
    cameraMode: "live-native",
    truth,
    conditions,
  });
  let t = 0;
  for (let f = 0; f < 12; f++) {
    t += 125;
    r.detected(
      {
        box: f >= 1 ? box : null,
        stable: f >= 3,
        stages: {
          resizeMs: jitter(3, 1),
          detectMs: jitter(70, 20),
          decodeMs: jitter(0.4, 0.2),
          totalMs: jitter(76, 22),
        },
      },
      t,
    );
    if (f === 4 || f === 8) {
      const top = lockTo ?? "p-apples";
      const score = lockTo ? 0.78 : 0.52;
      r.viewed(
        { timing: { cropMs: jitter(4, 2), embedMs: jitter(45, 10) } },
        [
          { productId: top, score },
          { productId: "p-maize", score: 0.41 },
          { productId: "p-bread", score: 0.33 },
        ],
        jitter(0.6, 0.3),
        f === 8 ? lockTo : null,
        t,
      );
    }
  }
  return r.finish("timeout", 10000);
}

const good = { lighting: "Good light", background: "Plain counter" };
const dim = { lighting: "Dim light", background: "Cluttered" };
const asTruth = (p) => ({ kind: "product", productId: p.productId, name: p.name, enrolledViews: p.views });
const plan = [
  [asTruth(products[0]), "p-bread", good],
  [asTruth(products[0]), "p-bread", dim],
  [asTruth(products[1]), "p-apples", good],
  [asTruth(products[1]), "p-bread", dim], // wrong lock
  [asTruth(products[2]), "p-maize", good],
  [asTruth(products[2]), null, dim], // timeout
  [{ kind: "unknown", label: "Sweets" }, null, good], // correct reject
  [{ kind: "unknown", label: "Soap" }, "p-maize", dim], // false accept
];
plan.forEach(([truth, lockTo, conditions], i) => {
  run = withTrial(run, trial(i + 1, truth, lockTo, conditions), context, "2026-11-07T09:00:00.000Z");
});

let clock = 0;
const fake = (ms) => async () => {
  clock += jitter(ms, ms * 0.2);
};
const opts = { warmup: 2, iterations: 20, now: () => clock, at: () => "2026-11-07T09:30:00.000Z" };
run = withBenchmarks(
  run,
  [
    await benchmark("detector_inference", "fixture", fake(68), opts),
    await benchmark("embedder_inference", "fixture", fake(41), opts),
  ],
  "2026-11-07T09:30:00.000Z",
);

writeFileSync(new URL("./sample_run.json", import.meta.url), runToJson(run) + "\n");
console.log(`wrote sample_run.json: ${run.trials.length} trials`);
