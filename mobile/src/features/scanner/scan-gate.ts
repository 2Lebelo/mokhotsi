/** How long a code must be out of view before the same code is accepted again. */
export const SCAN_REARM_MS = 1200;

/**
 * Cameras report a barcode on every analysed frame while it is in view. The gate
 * accepts a code once, then ignores it until it has been out of view for
 * `rearmMs`, so holding a can in front of the camera adds it exactly once.
 * A different code is accepted immediately.
 */
export class ScanGate {
  private lastCode: string | null = null;
  private lastSeenAt = Number.NEGATIVE_INFINITY;
  private readonly rearmMs: number;
  private readonly now: () => number;

  constructor(rearmMs = SCAN_REARM_MS, now: () => number = Date.now) {
    this.rearmMs = rearmMs;
    this.now = now;
  }

  accept(code: string): boolean {
    const at = this.now();
    const repeat =
      code === this.lastCode && at - this.lastSeenAt < this.rearmMs;
    this.lastCode = code;
    this.lastSeenAt = at;
    return !repeat;
  }
}
