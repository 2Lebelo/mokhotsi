import type { EvaluationRun } from "./run.ts";
import { STAGES } from "./trial.ts";

// Exports for analysis off the phone: the JSON file is complete (raw samples included) and is
// what ml/scripts/analyse_trials.py reads; the CSV is one tidy row per trial for a spreadsheet.

/** One CSV field, quoted when it needs to be (RFC 4180). */
export function csvField(value: unknown): string {
  if (value === null || value === undefined) return "";
  const text =
    typeof value === "number"
      ? Number.isFinite(value)
        ? String(value)
        : ""
      : String(value);
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

const csvRow = (fields: readonly unknown[]) => fields.map(csvField).join(",");

const STAGE_COLUMNS = STAGES.flatMap((stage) => [
  `${stage}_median_ms`,
  `${stage}_p95_ms`,
  `${stage}_n`,
]);

export const CSV_COLUMNS = [
  "run_id",
  "run_name",
  "trial",
  "started_at",
  "device_model",
  "build",
  "accelerator",
  "camera_mode",
  "lighting",
  "background",
  "truth_kind",
  "truth_product_id",
  "truth_name",
  "truth_enrolled_views",
  "outcome",
  "locked_product_id",
  "locked_score",
  "correct",
  "top3_hit",
  "rank1_correct",
  "rank1_product_id",
  "rank1_score",
  "rank2_product_id",
  "rank2_score",
  "rank3_product_id",
  "rank3_score",
  "first_detection_ms",
  "first_stable_ms",
  "first_view_ms",
  "lock_ms",
  "lock_from_detection_ms",
  "duration_ms",
  "frames_processed",
  "frames_with_item",
  "views_embedded",
  ...STAGE_COLUMNS,
] as const;

export function runToCsv(run: EvaluationRun): string {
  const { device, accelerator } = run.context;
  const rows = run.trials.map((t) => {
    const rank = (i: number) => t.finalRanking[i];
    const stageFields = STAGES.flatMap((stage) => {
      const s = t.stages[stage];
      return [s?.median, s?.p95, s?.n];
    });
    return csvRow([
      run.id,
      run.name,
      t.index,
      t.startedAt,
      device.model,
      device.build,
      accelerator,
      t.cameraMode,
      t.conditions.lighting,
      t.conditions.background,
      t.truth.kind,
      t.truth.kind === "product" ? t.truth.productId : "",
      t.truth.kind === "product" ? t.truth.name : t.truth.label,
      t.truth.kind === "product" ? t.truth.enrolledViews : "",
      t.outcome,
      t.lockedProductId,
      t.lockedScore,
      t.correct,
      t.top3Hit,
      t.rank1Correct,
      rank(0)?.productId,
      rank(0)?.score,
      rank(1)?.productId,
      rank(1)?.score,
      rank(2)?.productId,
      rank(2)?.score,
      t.firstDetectionMs,
      t.firstStableMs,
      t.firstViewMs,
      t.lockMs,
      t.lockFromDetectionMs,
      t.durationMs,
      t.framesProcessed,
      t.framesWithItem,
      t.viewsEmbedded,
      ...stageFields,
    ]);
  });
  // CRLF, as RFC 4180 and Excel expect.
  return [csvRow(CSV_COLUMNS), ...rows].join("\r\n") + "\r\n";
}

export function runToJson(run: EvaluationRun): string {
  return JSON.stringify(run, null, 2);
}

/** A file-name-safe stem, e.g. "eval-2026-11-07-good-light". */
export function fileStem(run: EvaluationRun): string {
  const name = run.name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
  return `eval-${run.createdAt.slice(0, 10)}${name ? `-${name}` : ""}-${run.id.slice(0, 8)}`;
}
