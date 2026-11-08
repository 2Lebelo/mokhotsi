import { summarise } from "./stats.ts";
import type { BenchmarkResult } from "./run.ts";

export type BenchmarkOptions = {
  warmup: number;
  iterations: number;
  /** Monotonic clock in ms (ml/clock's nowMs in the app). */
  now: () => number;
  /** Clock time as ISO text, for the record. */
  at: () => string;
  /** Lets the screen redraw a progress indicator between iterations. */
  onProgress?: (done: number, total: number) => void;
};

/**
 * Times `work` `iterations` times after `warmup` untimed runs. Runs are strictly sequential
 * (a model interpreter is not safe to share), and each one is timed on its own.
 */
export async function benchmark(
  name: string,
  description: string,
  work: () => unknown,
  { warmup, iterations, now, at, onProgress }: BenchmarkOptions,
): Promise<BenchmarkResult> {
  if (iterations < 1) throw new RangeError("A benchmark needs at least one run.");
  const total = warmup + iterations;
  for (let i = 0; i < warmup; i++) {
    await work();
    onProgress?.(i + 1, total);
  }
  const samples: number[] = [];
  for (let i = 0; i < iterations; i++) {
    const start = now();
    await work();
    samples.push(Math.round((now() - start) * 100) / 100);
    onProgress?.(warmup + i + 1, total);
  }
  return {
    name,
    description,
    at: at(),
    warmup,
    summary: summarise(samples),
    samples,
  };
}
