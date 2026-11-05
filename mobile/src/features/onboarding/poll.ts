/**
 * How long a waiting owner's phone waits between approval checks: quick at first (approval
 * often follows a phone call), then backing off to five minutes. Each delay is jittered by
 * ±20% so thousands of waiting phones never check in step.
 */
export const POLL_STEPS_MS = [15_000, 30_000, 60_000, 120_000, 300_000] as const;

export function nextDelay(attempt: number, random: () => number = Math.random): number {
  const base = POLL_STEPS_MS[Math.min(Math.max(attempt, 0), POLL_STEPS_MS.length - 1)];
  return Math.round(base * (0.8 + 0.4 * random()));
}
