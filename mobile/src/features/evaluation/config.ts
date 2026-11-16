/**
 * The research evaluation screen (Menu → Evaluation, owners only). Off unless the build sets
 * EXPO_PUBLIC_EVALUATION=1 (e.g. in mobile/.env.local), so shop builds never show it.
 * Metro inlines EXPO_PUBLIC_* at bundle time: restart Metro / rebuild after changing it.
 */
export const EVALUATION_ENABLED: boolean =
  process.env.EXPO_PUBLIC_EVALUATION?.trim() === "1";

export const EVALUATION = {
  /** A live trial without a lock by then is recorded as a timeout. */
  trialTimeoutMs: 10_000,
  /** Model benchmark: untimed warm-up runs, then timed runs. */
  benchmarkWarmup: 10,
  benchmarkIterations: 100,
  /** The till's voter (useIdentify): a product must win 2 of the last 3 views. */
  voterWindow: 3,
  voterNeeded: 2,
} as const;

export const LIGHTING = ["Good light", "Dim light"] as const;
export const BACKGROUNDS = ["Plain counter", "Cluttered"] as const;
