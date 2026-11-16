import assert from "node:assert/strict";
import test from "node:test";

import { benchmark } from "../src/features/evaluation/benchmark.ts";
import {
  CSV_COLUMNS,
  csvField,
  fileStem,
  runToCsv,
} from "../src/features/evaluation/export.ts";
import {
  formatProportion,
  summariseTrials,
} from "../src/features/evaluation/metrics.ts";
import {
  newRun,
  nextTrialIndex,
  parseRun,
  withoutTrial,
  withTrial,
} from "../src/features/evaluation/run.ts";
import {
  proportion,
  quantile,
  summarise,
} from "../src/features/evaluation/stats.ts";
import { TrialRecorder } from "../src/features/evaluation/trial.ts";

const CONDITIONS = { lighting: "Good light", background: "Plain counter" };
const BREAD = {
  kind: "product",
  productId: "bread",
  name: "Bread, brown",
  enrolledViews: 4,
};
const UNKNOWN = { kind: "unknown", label: "Sweets" };

const box = { x: 0.2, y: 0.2, width: 0.5, height: 0.5, score: 0.9 };
const frame = (stable, withBox = true) => ({
  box: withBox ? box : null,
  stable,
  latencyMs: 60,
  stages: { resizeMs: 2, detectMs: 50, decodeMs: 0.5, totalMs: 60 },
});
const view = { timing: { cropMs: 3, embedMs: 40 } };

function recorder(truth, t0 = 1000) {
  return new TrialRecorder({
    index: 1,
    startedAt: "2026-11-07T08:00:00.000Z",
    t0,
    cameraMode: "live-native",
    truth,
    conditions: CONDITIONS,
  });
}

test("stats: numpy-linear quantiles, sample sd, Wilson interval", () => {
  assert.equal(quantile([1, 2, 3, 4], 0.5), 2.5);
  assert.equal(quantile([10], 0.95), 10);
  assert.ok(Math.abs(quantile([1, 2, 3, 4, 5], 0.95) - 4.8) < 1e-9);
  const s = summarise([4, 2, 1, 3]);
  assert.equal(s.n, 4);
  assert.equal(s.mean, 2.5);
  assert.equal(s.median, 2.5);
  assert.equal(s.sd, 1.29); // sqrt(5/3)
  assert.equal(s.min, 1);
  assert.equal(s.max, 4);
  assert.throws(() => summarise([]));

  // Reference values: statsmodels proportion_confint(8, 10, method="wilson").
  const p = proportion(8, 10);
  assert.equal(p.rate, 0.8);
  assert.ok(Math.abs(p.low - 0.4902) < 1e-4);
  assert.ok(Math.abs(p.high - 0.9433) < 1e-4);
  // Never outside [0, 1], even at the extremes.
  assert.equal(proportion(0, 5).low, 0);
  assert.equal(proportion(5, 5).high, 1);
  assert.deepEqual(proportion(0, 0), {
    k: 0,
    n: 0,
    rate: null,
    low: null,
    high: null,
  });
});

test("TrialRecorder: a live trial that locks to the right product", () => {
  const r = recorder(BREAD);
  r.detected(frame(false, false), 1100); // empty frame
  r.detected(frame(false), 1200); // item appears
  r.detected(frame(true), 1325); // held still
  r.viewed(view, [{ productId: "milk", score: 0.7 }], 0.4, null, 1500);
  r.viewed(
    view,
    [
      { productId: "bread", score: 0.82 },
      { productId: "milk", score: 0.7 },
      { productId: "eggs", score: 0.5 },
      { productId: "rice", score: 0.4 },
    ],
    0.6,
    "bread",
    2000,
  );
  // Anything after the lock is ignored.
  r.detected(frame(true), 2100);
  r.viewed(view, [{ productId: "milk", score: 0.99 }], 0.5, "milk", 2200);
  const t = r.finish("timeout", 9000);

  assert.equal(t.outcome, "locked");
  assert.equal(t.lockedProductId, "bread");
  assert.equal(t.lockedScore, 0.82);
  assert.equal(t.correct, true);
  assert.equal(t.top3Hit, true);
  assert.equal(t.rank1Correct, true);
  assert.equal(t.finalRanking.length, 3, "only the top 3 are kept");
  assert.deepEqual(t.firstRanking, [{ productId: "milk", score: 0.7 }]);
  assert.equal(t.firstDetectionMs, 200);
  assert.equal(t.firstStableMs, 325);
  assert.equal(t.firstViewMs, 500);
  assert.equal(t.lockMs, 1000);
  assert.equal(t.lockFromDetectionMs, 800);
  assert.equal(t.durationMs, 1000, "a locked trial ends at the lock");
  assert.equal(t.framesProcessed, 3);
  assert.equal(t.framesWithItem, 2);
  assert.equal(t.viewsEmbedded, 2);
  assert.deepEqual(t.samples.detect, [50, 50, 50]);
  assert.deepEqual(t.samples.match, [0.4, 0.6]);
  assert.equal(t.stages.embed.median, 40);
  assert.equal(t.stages.capture, undefined);
});

test("TrialRecorder: timeouts, wrong locks, unknown items and still photos", () => {
  // A known item that never locks: wrong, but its top-3 can still hold the answer.
  const slow = recorder(BREAD);
  slow.detected(frame(true), 1100);
  slow.viewed(
    view,
    [
      { productId: "milk", score: 0.55 },
      { productId: "bread", score: 0.54 },
    ],
    0.5,
    null,
    1400,
  );
  const timedOut = slow.finish("timeout", 11000);
  assert.equal(timedOut.outcome, "timeout");
  assert.equal(timedOut.correct, false);
  assert.equal(timedOut.top3Hit, true);
  assert.equal(timedOut.rank1Correct, false);
  assert.equal(timedOut.lockMs, null);
  assert.equal(timedOut.durationMs, 10000);

  // An unknown item is right when nothing locks, wrong when something does.
  const unknownRejected = recorder(UNKNOWN).finish("timeout", 11000);
  assert.equal(unknownRejected.correct, true);
  assert.equal(unknownRejected.top3Hit, null);
  assert.equal(unknownRejected.firstDetectionMs, null);
  const accepted = recorder(UNKNOWN);
  accepted.viewed(view, [{ productId: "milk", score: 0.9 }], 0.5, "milk", 1500);
  assert.equal(accepted.finish("timeout", 2000).correct, false);

  // Still mode: capture and decode timings come with the one view.
  const still = recorder(BREAD);
  still.viewed(
    {
      timing: { cropMs: 20, detectMs: 70, embedMs: 45, captureMs: 300, decodeMs: 80 },
    },
    [{ productId: "bread", score: 0.5 }],
    0.3,
    null,
    1900,
  );
  const rejected = still.finish("rejected", 1900);
  assert.equal(rejected.outcome, "rejected");
  assert.equal(rejected.rank1Correct, true);
  assert.deepEqual(rejected.samples.capture, [300]);
  assert.deepEqual(rejected.samples.photoDecode, [80]);
  assert.deepEqual(rejected.samples.detect, [70]);
  assert.equal(rejected.lockFromDetectionMs, null);
});

function trial(truth, lockedProductId, extra = {}) {
  const r = recorder(truth);
  r.detected(frame(true), 1100);
  r.viewed(
    view,
    lockedProductId
      ? [{ productId: lockedProductId, score: 0.8 }]
      : [{ productId: "milk", score: 0.4 }],
    0.5,
    lockedProductId,
    1600,
  );
  return { ...r.finish("timeout", 11000), ...extra };
}

test("summariseTrials: accuracy, precision, false accepts and pooled latency", () => {
  const trials = [
    trial(BREAD, "bread"),
    trial(BREAD, "bread"),
    trial(BREAD, "milk"), // wrong lock
    trial(BREAD, null), // timeout
    trial(UNKNOWN, null), // correct reject
    trial(UNKNOWN, "milk"), // false accept
  ];
  const s = summariseTrials(trials);
  assert.equal(s.trials, 6);
  assert.equal(s.known, 4);
  assert.equal(s.unknown, 2);
  assert.deepEqual([s.top1.k, s.top1.n], [2, 4]);
  assert.deepEqual([s.lockRate.k, s.lockRate.n], [3, 4]);
  assert.deepEqual([s.precision.k, s.precision.n], [2, 3]);
  assert.deepEqual([s.falseAccept.k, s.falseAccept.n], [1, 2]);
  assert.deepEqual([s.overall.k, s.overall.n], [3, 6]);
  assert.equal(s.timeToLock.n, 3, "only known trials that locked");
  assert.equal(s.timeToLock.median, 600);
  assert.equal(s.lockFromDetection.median, 500);
  assert.equal(s.stages.detect.n, 6, "samples are pooled across trials");
  assert.match(formatProportion(s.top1), /^50\.0% \(95% CI .+, 2\/4\)$/);
  assert.equal(formatProportion(summariseTrials([]).top1), "–");
});

const CONTEXT = {
  device: {
    model: "SM-A045F",
    manufacturer: "samsung",
    os: "android",
    osVersion: "14",
    memoryBytes: 3e9,
    appVersion: "1.0.0",
    build: "release",
  },
  accelerator: "cpu",
  models: { detector: "d@1", embedder: "e@1" },
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
  index: { views: 8, products: 2 },
  enrolled: [],
};

test("runs: trial numbers are never reused, and files are validated", () => {
  let run = newRun("abcdef12-3456", "Counter, morning", CONTEXT, "2026-11-07T08:00:00Z");
  assert.equal(nextTrialIndex(run), 1);
  run = withTrial(run, { ...trial(BREAD, "bread"), index: 1 }, CONTEXT, "t1");
  run = withTrial(run, { ...trial(BREAD, "bread"), index: 2 }, CONTEXT, "t2");
  run = withoutTrial(run, 2, "t3");
  assert.equal(run.trials.length, 1);
  assert.equal(nextTrialIndex(run), 2);
  assert.equal(run.updatedAt, "t3");
  assert.equal(parseRun(JSON.parse(JSON.stringify(run))).id, run.id);
  assert.throws(() => parseRun({ schema: "something-else" }));
  assert.throws(() => parseRun(null));
});

test("CSV export: one escaped row per trial, columns in a fixed order", () => {
  assert.equal(csvField(null), "");
  assert.equal(csvField(Number.NaN), "");
  assert.equal(csvField(0.5), "0.5");
  assert.equal(csvField(false), "false");
  assert.equal(csvField('Maize "white", 1kg'), '"Maize ""white"", 1kg"');
  assert.equal(csvField("two\nlines"), '"two\nlines"');

  let run = newRun("abcdef12-3456", "Counter, morning", CONTEXT, "2026-11-07T08:00:00Z");
  run = withTrial(
    run,
    trial({ ...BREAD, name: 'Bread "brown", sliced' }, "bread"),
    CONTEXT,
    "t",
  );
  run = withTrial(run, { ...trial(UNKNOWN, null), index: 2 }, CONTEXT, "t");
  const csv = runToCsv(run);
  const lines = csv.trimEnd().split("\r\n");
  assert.equal(lines.length, 3);
  assert.equal(lines[0], CSV_COLUMNS.join(","));
  assert.ok(lines[1].startsWith('abcdef12-3456,"Counter, morning",1,'));
  assert.ok(lines[1].includes('"Bread ""brown"", sliced"'));
  assert.ok(lines[2].includes(",unknown,,Sweets,,timeout,,,true,,,"));
  assert.ok(csv.endsWith("\r\n"));
  assert.equal(fileStem(run), "eval-2026-11-07-counter-morning-abcdef12");
});

test("benchmark: warm-up runs are not timed, each timed run is", async () => {
  let clock = 0;
  let calls = 0;
  const progress = [];
  const result = await benchmark(
    "fake",
    "advances the clock by the call number",
    () => {
      calls++;
      clock += calls;
    },
    {
      warmup: 2,
      iterations: 3,
      now: () => clock,
      at: () => "now",
      onProgress: (done, total) => progress.push(`${done}/${total}`),
    },
  );
  assert.equal(calls, 5);
  assert.deepEqual(result.samples, [3, 4, 5]);
  assert.equal(result.summary.median, 4);
  assert.equal(result.warmup, 2);
  assert.deepEqual(progress, ["1/5", "2/5", "3/5", "4/5", "5/5"]);
  await assert.rejects(() =>
    benchmark("none", "", () => {}, { warmup: 0, iterations: 0, now: () => 0, at: () => "" }),
  );
});
