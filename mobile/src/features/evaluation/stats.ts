// Small descriptive statistics, defined exactly as ml/scripts/_metrics.py defines them, so
// the numbers on the phone and in the thesis tables agree.

export type LatencySummary = {
  n: number;
  mean: number;
  sd: number;
  min: number;
  median: number;
  p90: number;
  p95: number;
  max: number;
};

export type Proportion = {
  /** Successes. */
  k: number;
  /** Trials. */
  n: number;
  /** k / n, or null when n = 0. */
  rate: number | null;
  /** Wilson score 95% interval, or null when n = 0. */
  low: number | null;
  high: number | null;
};

/** Linear-interpolated quantile of sorted values (numpy's default, "linear"). */
export function quantile(sorted: readonly number[], q: number): number {
  if (sorted.length === 0) throw new RangeError("quantile of no values");
  const position = (sorted.length - 1) * q;
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  const weight = position - lower;
  return sorted[lower] + (sorted[upper] - sorted[lower]) * weight;
}

const round = (value: number) => Math.round(value * 100) / 100;

/** Summary of latency samples in milliseconds; sd is the sample standard deviation. */
export function summarise(values: readonly number[]): LatencySummary {
  if (values.length === 0) throw new RangeError("summarise of no values");
  const sorted = [...values].sort((a, b) => a - b);
  const n = sorted.length;
  const mean = sorted.reduce((sum, v) => sum + v, 0) / n;
  const variance =
    n > 1 ? sorted.reduce((sum, v) => sum + (v - mean) ** 2, 0) / (n - 1) : 0;
  return {
    n,
    mean: round(mean),
    sd: round(Math.sqrt(variance)),
    min: round(sorted[0]),
    median: round(quantile(sorted, 0.5)),
    p90: round(quantile(sorted, 0.9)),
    p95: round(quantile(sorted, 0.95)),
    max: round(sorted[n - 1]),
  };
}

/** z for a two-sided 95% interval. */
const Z95 = 1.959963984540054;

/** k of n with a Wilson score 95% interval (sound for small samples and rates near 0 or 1). */
export function proportion(k: number, n: number): Proportion {
  if (n === 0) return { k, n, rate: null, low: null, high: null };
  const p = k / n;
  const z2 = Z95 * Z95;
  const denominator = 1 + z2 / n;
  const centre = (p + z2 / (2 * n)) / denominator;
  const half =
    (Z95 * Math.sqrt((p * (1 - p)) / n + z2 / (4 * n * n))) / denominator;
  return {
    k,
    n,
    rate: p,
    low: Math.max(0, centre - half),
    high: Math.min(1, centre + half),
  };
}
