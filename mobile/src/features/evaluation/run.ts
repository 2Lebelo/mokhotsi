import type { LatencySummary } from "./stats.ts";
import type { TrialRecord } from "./trial.ts";

/** Bump when the file shape changes; ml/scripts/analyse_trials.py checks it. */
export const RUN_SCHEMA = "mokhotsi-evaluation-run/1";

/** One micro-benchmark: the same operation repeated on fixed input. */
export type BenchmarkResult = {
  name: string;
  /** What exactly was timed, for the thesis. */
  description: string;
  at: string;
  warmup: number;
  summary: LatencySummary;
  samples: number[];
};

/** Everything a set of trials was measured on, recorded so results can be reproduced. */
export type RunContext = {
  device: {
    model: string;
    manufacturer: string;
    os: string;
    osVersion: string;
    memoryBytes: number | null;
    appVersion: string;
    /** "release" numbers are the ones to report; dev builds run much slower. */
    build: "release" | "development";
  };
  accelerator: string;
  models: { detector: string; embedder: string };
  thresholds: {
    detectorShow: number;
    detectorKeep: number;
    accept: number;
    margin: number;
    topK: number;
    voterWindow: number;
    voterNeeded: number;
  };
  pipeline: {
    detectorMaxFps: number;
    embedderMaxPerSecond: number;
    stableFrames: number;
    cropPad: number;
    trialTimeoutMs: number;
  };
  index: { views: number; products: number };
  enrolled: { productId: string; name: string; views: number }[];
};

export type EvaluationRun = {
  schema: typeof RUN_SCHEMA;
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  /** Captured when the run was created; `contextAtLastTrial` notes later changes. */
  context: RunContext;
  contextAtLastTrial?: RunContext;
  trials: TrialRecord[];
  benchmarks: BenchmarkResult[];
};

export function newRun(
  id: string,
  name: string,
  context: RunContext,
  at: string,
): EvaluationRun {
  return {
    schema: RUN_SCHEMA,
    id,
    name,
    createdAt: at,
    updatedAt: at,
    context,
    trials: [],
    benchmarks: [],
  };
}

export function withTrial(
  run: EvaluationRun,
  trial: TrialRecord,
  context: RunContext,
  at: string,
): EvaluationRun {
  return {
    ...run,
    updatedAt: at,
    contextAtLastTrial: context,
    trials: [...run.trials, trial],
  };
}

export function withoutTrial(
  run: EvaluationRun,
  index: number,
  at: string,
): EvaluationRun {
  return {
    ...run,
    updatedAt: at,
    trials: run.trials.filter((t) => t.index !== index),
  };
}

export function withBenchmarks(
  run: EvaluationRun,
  results: readonly BenchmarkResult[],
  at: string,
): EvaluationRun {
  return { ...run, updatedAt: at, benchmarks: [...run.benchmarks, ...results] };
}

/** The next trial number: never reused, even after a discard. */
export function nextTrialIndex(run: EvaluationRun): number {
  return run.trials.reduce((max, t) => Math.max(max, t.index), 0) + 1;
}

/** Throws unless `value` looks like a run this version can read. */
export function parseRun(value: unknown): EvaluationRun {
  const run = value as Partial<EvaluationRun> | null;
  if (
    !run ||
    run.schema !== RUN_SCHEMA ||
    typeof run.id !== "string" ||
    !Array.isArray(run.trials) ||
    !Array.isArray(run.benchmarks) ||
    !run.context
  )
    throw new Error("This is not an evaluation run this app can read.");
  return run as EvaluationRun;
}
