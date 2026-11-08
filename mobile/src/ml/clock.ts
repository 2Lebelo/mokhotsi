/**
 * A monotonic millisecond clock for measuring pipeline stages. Uses `performance.now()`
 * (sub-millisecond, unaffected by the wall clock) where the runtime has it, including the
 * camera thread's worklet runtime, and falls back to `Date.now()` elsewhere.
 * Only differences between two readings mean anything.
 */
export function nowMs(): number {
  "worklet";
  const perf = (globalThis as { performance?: { now?: () => number } })
    .performance;
  return perf && typeof perf.now === "function" ? perf.now() : Date.now();
}

/** Milliseconds since `start` (a `nowMs()` reading), rounded to 0.01 ms. */
export function elapsedMs(start: number): number {
  "worklet";
  return Math.round((nowMs() - start) * 100) / 100;
}
