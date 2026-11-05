import type { SyncState } from "./shop-sync.ts";

/** A shop's sync as the menu shows it. */
export type ShopSyncStatus = {
  state: SyncState | "syncing" | "idle";
  /** Changes waiting to be sent. */
  pending: number;
  lastSyncedAt: string | null;
  message?: string;
};

export type ShopRun = Omit<ShopSyncStatus, "state"> & { state: SyncState };

/** Each shop's outcome in one complete run; a shop whose run threw has no `pending`. */
export type FlushResult = Record<string, Partial<ShopRun>>;

export type SchedulerOptions = {
  /** The shops this phone syncs (none while it is not registered). */
  shops: () => readonly string[];
  sync: (shopId: string) => Promise<ShopRun>;
  onStatus: (shopId: string, status: Partial<ShopSyncStatus>) => void;
  now?: () => number;
  random?: () => number;
  setTimer?: (run: () => void, ms: number) => unknown;
  clearTimer?: (timer: unknown) => void;
};

/** While the app is open and nothing else happens, the shop is checked this often. */
export const PERIOD_MS = 5 * 60_000;
/** After a sale or edit: soon, but batching a burst of scans into one push. */
export const AFTER_WRITE_MS = 30_000;
const RETRY_MIN_MS = 30_000;
const RETRY_MAX_MS = 15 * 60_000;

/** Full-jitter exponential backoff (30 s doubling to 15 min), so phones never retry in step. */
export function retryDelay(failures: number, random: () => number = Math.random): number {
  const cap = Math.min(RETRY_MAX_MS, RETRY_MIN_MS * 2 ** Math.max(0, failures - 1));
  return Math.max(5_000, Math.round(random() * cap));
}

/**
 * When the phone syncs: on start, back in the foreground, when the network returns, shortly
 * after a local change, every few minutes while open, and on request. One run at a time;
 * shops of the phone are synced one after another. Paused in the background (Android may
 * stop the app there anyway).
 */
export class SyncScheduler {
  private options: Required<SchedulerOptions>;
  private timer: unknown = null;
  private dueAt = Infinity;
  private running = false;
  private again = false;
  private failures = 0;
  private active = false;
  /** Callers of flush() waiting for a run that starts after their call. */
  private flushes: ((result: FlushResult) => void)[] = [];

  constructor(options: SchedulerOptions) {
    this.options = {
      now: Date.now,
      random: Math.random,
      setTimer: (run, ms) => setTimeout(run, ms),
      clearTimer: (timer) => clearTimeout(timer as ReturnType<typeof setTimeout>),
      ...options,
    };
  }

  /** The app is in the foreground (true) or not; coming back syncs at once. */
  setActive(active: boolean): void {
    this.active = active;
    if (active) this.schedule(0);
    else this.cancel();
  }

  /** The network came back: whatever failed before is worth trying now. */
  networkBack(): void {
    this.failures = 0;
    this.schedule(0);
  }

  /** Something changed locally. */
  nudge(): void {
    this.schedule(AFTER_WRITE_MS);
  }

  syncNow(): void {
    this.schedule(0);
  }

  /**
   * Syncs every shop now, even in the background, and resolves with each one's outcome from a
   * run that started after this call (a run already under way may have missed recent changes).
   */
  flush(): Promise<FlushResult> {
    return new Promise((resolve) => {
      this.flushes.push(resolve);
      this.cancel();
      void this.tick();
    });
  }

  stop(): void {
    this.active = false;
    this.cancel();
    for (const resolve of this.flushes.splice(0)) resolve({});
  }

  /** Arms the timer unless a run is already due sooner. */
  private schedule(delayMs: number): void {
    if (!this.active) return;
    const at = this.options.now() + delayMs;
    if (this.timer !== null && this.dueAt <= at) return;
    this.cancel();
    this.dueAt = at;
    this.timer = this.options.setTimer(() => void this.tick(), delayMs);
  }

  private cancel(): void {
    if (this.timer !== null) this.options.clearTimer(this.timer);
    this.timer = null;
    this.dueAt = Infinity;
  }

  private async tick(): Promise<void> {
    this.timer = null;
    this.dueAt = Infinity;
    if (this.running) {
      this.again = true;
      return;
    }
    this.running = true;
    let failed = false;
    const waiting = this.flushes.splice(0);
    const result: FlushResult = {};
    try {
      for (const shopId of this.options.shops()) {
        this.options.onStatus(shopId, { state: "syncing" });
        let run: Partial<ShopRun>;
        try {
          run = await this.options.sync(shopId);
        } catch (cause) {
          // Counts are unknown here; keep the last ones shown.
          run = { state: "error", message: cause instanceof Error ? cause.message : String(cause) };
        }
        result[shopId] = run;
        this.options.onStatus(shopId, run);
        if (run.state === "offline" || run.state === "error") failed = true;
      }
    } finally {
      this.running = false;
      for (const resolve of waiting) resolve(result);
    }
    if (this.flushes.length) {
      // Asked for during this run: run again at once, whether active or not.
      this.again = false;
      void this.tick();
      return;
    }
    if (this.again) {
      this.again = false;
      this.schedule(0);
      return;
    }
    this.failures = failed ? this.failures + 1 : 0;
    this.schedule(failed ? retryDelay(this.failures, this.options.random) : PERIOD_MS);
  }
}
