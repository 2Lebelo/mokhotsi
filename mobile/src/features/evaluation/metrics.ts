import {
  proportion,
  summarise,
  type LatencySummary,
  type Proportion,
} from "./stats.ts";
import { STAGES, type StageName, type TrialRecord } from "./trial.ts";

// The headline numbers for a set of trials. Definitions (also in docs/evaluation-protocol.md):
// - Known trials: the item has photos in the shop. Unknown trials: it has none.
// - Top-1 accuracy: known trials where the system locked to the right product.
// - Top-3 hit rate: known trials where the right product was in the last top-3 shown.
// - Rank-1 accuracy: known trials whose last ranking put the right product first, threshold
//   or not (what the cashier sees first in "Closest matches").
// - Lock rate: known trials where the system committed to any product.
// - Precision: of known trials that locked, the share that locked to the right product.
// - False-accept rate: unknown trials where the system locked to some product.

export type EvaluationSummary = {
  trials: number;
  known: number;
  unknown: number;
  top1: Proportion;
  top3: Proportion;
  rank1: Proportion;
  lockRate: Proportion;
  precision: Proportion;
  falseAccept: Proportion;
  /** Overall: correct decisions over all trials (known and unknown). */
  overall: Proportion;
  /** Locked known trials, from pressing Start. */
  timeToLock: LatencySummary | null;
  /** Locked live trials, from the first frame with an item in it. */
  lockFromDetection: LatencySummary | null;
  /** Every sample of each stage, pooled over the trials. */
  stages: Partial<Record<StageName, LatencySummary>>;
};

function summaryOrNull(values: number[]): LatencySummary | null {
  return values.length ? summarise(values) : null;
}

export function summariseTrials(
  trials: readonly TrialRecord[],
): EvaluationSummary {
  const known = trials.filter((t) => t.truth.kind === "product");
  const unknown = trials.filter((t) => t.truth.kind === "unknown");
  const knownLocked = known.filter((t) => t.outcome === "locked");
  const count = (list: readonly TrialRecord[], test: (t: TrialRecord) => boolean) =>
    list.filter(test).length;

  const stages: Partial<Record<StageName, LatencySummary>> = {};
  for (const stage of STAGES) {
    const pooled = trials.flatMap((t) => t.samples[stage] ?? []);
    if (pooled.length) stages[stage] = summarise(pooled);
  }

  const lockedTimes = (pick: (t: TrialRecord) => number | null) =>
    knownLocked
      .map(pick)
      .filter((v): v is number => v !== null);

  return {
    trials: trials.length,
    known: known.length,
    unknown: unknown.length,
    top1: proportion(count(known, (t) => t.correct), known.length),
    top3: proportion(count(known, (t) => t.top3Hit === true), known.length),
    rank1: proportion(count(known, (t) => t.rank1Correct === true), known.length),
    lockRate: proportion(knownLocked.length, known.length),
    precision: proportion(count(knownLocked, (t) => t.correct), knownLocked.length),
    falseAccept: proportion(
      count(unknown, (t) => t.outcome === "locked"),
      unknown.length,
    ),
    overall: proportion(count(trials, (t) => t.correct), trials.length),
    timeToLock: summaryOrNull(lockedTimes((t) => t.lockMs)),
    lockFromDetection: summaryOrNull(lockedTimes((t) => t.lockFromDetectionMs)),
    stages,
  };
}

/** "87.5% (95% CI 64.0–96.5%, 14/16)", or "–" with no trials. */
export function formatProportion(p: Proportion): string {
  if (p.rate === null || p.low === null || p.high === null) return "–";
  const pct = (v: number) => `${(v * 100).toFixed(1)}%`;
  return `${pct(p.rate)} (95% CI ${pct(p.low)}–${pct(p.high)}, ${p.k}/${p.n})`;
}

/** "312 ms median · 480 ms p95 (n = 16)", or "–". */
export function formatLatency(s: LatencySummary | null | undefined): string {
  if (!s) return "–";
  return `${s.median.toFixed(1)} ms median · ${s.p95.toFixed(1)} ms p95 (n = ${s.n})`;
}
