import type { Candidate } from "../../ml/vector-index.ts";
import { summarise, type LatencySummary } from "./stats.ts";

// One evaluation trial: the researcher names what is in front of the camera (the ground
// truth), the unchanged recognition pipeline runs, and this records what it decided and how
// long every step took. Pure and clock-free (times are passed in), so it is unit-tested.

/** What was really in front of the camera. */
export type TrialTruth =
  | { kind: "product"; productId: string; name: string; enrolledViews: number }
  /** An item that has no photos in this shop: the right answer is "no match". */
  | { kind: "unknown"; label: string };

export type TrialConditions = {
  lighting: string;
  background: string;
};

/**
 * - `locked`: the pipeline committed to a product (live: the 2-of-3 voter; still: one view
 *   that clears the accept threshold and margin).
 * - `rejected`: still mode, the one captured view did not clear the threshold.
 * - `timeout`: live mode, no lock before the trial's time limit.
 */
export type TrialOutcome = "locked" | "rejected" | "timeout";

export type StageName =
  | "resize"
  | "detect"
  | "decode"
  | "frame"
  | "crop"
  | "embed"
  | "match"
  | "capture"
  | "photoDecode";

export const STAGES: readonly StageName[] = [
  "resize",
  "detect",
  "decode",
  "frame",
  "crop",
  "embed",
  "match",
  "capture",
  "photoDecode",
];

/** What one live frame reports (a structural subset of LiveDetection). */
export type FrameReport = {
  box: unknown;
  stable: boolean;
  stages?: {
    resizeMs: number;
    detectMs: number;
    decodeMs: number;
    totalMs: number;
  };
};

/** What one embedded view reports (a structural subset of EmbeddedView). */
export type ViewReport = {
  timing?: {
    cropMs?: number;
    embedMs?: number;
    detectMs?: number;
    captureMs?: number;
    decodeMs?: number;
  };
};

export type TrialRecord = {
  /** 1-based position in the run. */
  index: number;
  startedAt: string;
  cameraMode: string;
  truth: TrialTruth;
  conditions: TrialConditions;
  outcome: TrialOutcome;
  lockedProductId: string | null;
  lockedScore: number | null;
  /**
   * The system's decision was right: a known item locked to the right product, or an
   * unknown item locked to nothing.
   */
  correct: boolean;
  /** Known items: the right product was in the last top-3 shown. Unknown items: null. */
  top3Hit: boolean | null;
  /** Known items: the last ranking's first place was right, ignoring thresholds. */
  rank1Correct: boolean | null;
  firstRanking: Candidate[];
  finalRanking: Candidate[];
  /** Milliseconds from the trial's start (null: never happened). */
  firstDetectionMs: number | null;
  firstStableMs: number | null;
  firstViewMs: number | null;
  lockMs: number | null;
  /** Lock time measured from the first frame with an item in it (live only). */
  lockFromDetectionMs: number | null;
  durationMs: number;
  framesProcessed: number;
  framesWithItem: number;
  viewsEmbedded: number;
  /** Per-stage summaries over this trial's samples. */
  stages: Partial<Record<StageName, LatencySummary>>;
  /** Every raw sample (ms), for pooled analysis offline. */
  samples: Partial<Record<StageName, number[]>>;
};

export type TrialStart = {
  index: number;
  startedAt: string;
  /** Monotonic clock reading at the start (see ml/clock). */
  t0: number;
  cameraMode: string;
  truth: TrialTruth;
  conditions: TrialConditions;
};

export class TrialRecorder {
  private readonly start: TrialStart;
  private readonly samples: Partial<Record<StageName, number[]>> = {};
  private firstDetection: number | null = null;
  private firstStable: number | null = null;
  private firstView: number | null = null;
  private lock: { at: number; productId: string; score: number } | null = null;
  private firstRanking: Candidate[] = [];
  private finalRanking: Candidate[] = [];
  private frames = 0;
  private framesWithItem = 0;
  private views = 0;

  constructor(start: TrialStart) {
    this.start = start;
  }

  get locked(): boolean {
    return this.lock !== null;
  }

  private add(stage: StageName, ms: number | undefined): void {
    if (ms === undefined || !Number.isFinite(ms)) return;
    (this.samples[stage] ??= []).push(ms);
  }

  private since(t: number): number {
    return Math.round((t - this.start.t0) * 100) / 100;
  }

  /** A live frame went through the detector. Ignored after the lock. */
  detected(frame: FrameReport, t: number): void {
    if (this.lock) return;
    this.frames++;
    if (frame.box) {
      this.framesWithItem++;
      this.firstDetection ??= t;
      if (frame.stable) this.firstStable ??= t;
    }
    if (frame.stages) {
      this.add("resize", frame.stages.resizeMs);
      this.add("detect", frame.stages.detectMs);
      this.add("decode", frame.stages.decodeMs);
      this.add("frame", frame.stages.totalMs);
    }
  }

  /**
   * A view was embedded and ranked; `lockedProductId` is the decision it led to, if any.
   * Views after the lock are ignored: the cashier would already be looking at the result.
   */
  viewed(
    view: ViewReport,
    ranking: readonly Candidate[],
    matchMs: number,
    lockedProductId: string | null,
    t: number,
  ): void {
    if (this.lock) return;
    this.views++;
    this.firstView ??= t;
    const top = ranking.slice(0, 3).map((c) => ({ ...c }));
    if (this.views === 1) this.firstRanking = top;
    this.finalRanking = top;
    const timing = view.timing ?? {};
    this.add("crop", timing.cropMs);
    this.add("embed", timing.embedMs);
    this.add("match", matchMs);
    this.add("capture", timing.captureMs);
    this.add("photoDecode", timing.decodeMs);
    // A still photo also ran the detector.
    this.add("detect", timing.detectMs);
    if (lockedProductId) {
      const score =
        ranking.find((c) => c.productId === lockedProductId)?.score ?? 0;
      this.lock = { at: t, productId: lockedProductId, score };
    }
  }

  /** Ends the trial. `fallback` is the outcome without a lock (`timeout` or `rejected`). */
  finish(fallback: "timeout" | "rejected", t: number): TrialRecord {
    const { truth } = this.start;
    const lockedProductId = this.lock?.productId ?? null;
    const known = truth.kind === "product";
    const correct = known
      ? lockedProductId === truth.productId
      : lockedProductId === null;
    const stages: Partial<Record<StageName, LatencySummary>> = {};
    for (const stage of STAGES) {
      const values = this.samples[stage];
      if (values?.length) stages[stage] = summarise(values);
    }
    return {
      index: this.start.index,
      startedAt: this.start.startedAt,
      cameraMode: this.start.cameraMode,
      truth,
      conditions: { ...this.start.conditions },
      outcome: this.lock ? "locked" : fallback,
      lockedProductId,
      lockedScore: this.lock?.score ?? null,
      correct,
      top3Hit: known
        ? this.finalRanking.some((c) => c.productId === truth.productId)
        : null,
      rank1Correct: known
        ? this.finalRanking[0]?.productId === truth.productId
        : null,
      firstRanking: this.firstRanking,
      finalRanking: this.finalRanking,
      firstDetectionMs:
        this.firstDetection === null ? null : this.since(this.firstDetection),
      firstStableMs:
        this.firstStable === null ? null : this.since(this.firstStable),
      firstViewMs: this.firstView === null ? null : this.since(this.firstView),
      lockMs: this.lock ? this.since(this.lock.at) : null,
      lockFromDetectionMs:
        this.lock && this.firstDetection !== null
          ? Math.round((this.lock.at - this.firstDetection) * 100) / 100
          : null,
      durationMs: this.since(this.lock?.at ?? t),
      framesProcessed: this.frames,
      framesWithItem: this.framesWithItem,
      viewsEmbedded: this.views,
      stages,
      samples: Object.fromEntries(
        Object.entries(this.samples).map(([k, v]) => [k, [...v]]),
      ),
    };
  }
}
