/**
 * The phone's own PIN lockout, for PINs checked offline. After MAX_FAILURES wrong PINs the pad
 * locks for 30 s, and each further lockout doubles (capped at an hour). It is per phone, not
 * per person: a wrong PIN matches nobody, so there is no person to count it against.
 */

export const MAX_FAILURES = 5;
const BASE_MS = 30_000;
const CAP_MS = 60 * 60_000;

export type LockoutState = {
  failures: number;
  lockouts: number;
  /** Epoch milliseconds, or null when the pad is open. */
  lockedUntil: number | null;
};

export const OPEN: LockoutState = { failures: 0, lockouts: 0, lockedUntil: null };

export function remainingMs(state: LockoutState, now: number): number {
  return state.lockedUntil === null ? 0 : Math.max(0, state.lockedUntil - now);
}

export function recordFailure(state: LockoutState, now: number): LockoutState {
  const failures = state.failures + 1;
  if (failures < MAX_FAILURES) return { ...state, failures };
  const wait = Math.min(BASE_MS * 2 ** Math.min(state.lockouts, 20), CAP_MS);
  return { failures: 0, lockouts: state.lockouts + 1, lockedUntil: now + wait };
}
