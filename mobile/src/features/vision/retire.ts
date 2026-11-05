// Frees native resources that another thread may still be using. The live pipeline's
// resizers are used on the camera thread, which can be mid-frame (holding a GPUFrame for a
// whole detector run) when React unmounts the camera on the JS thread. Freeing a resizer
// then throws, or, if it lands just before the camera thread starts a resize, frees the
// pipeline under it. So the caller first stops new frames, then this waits for the last
// one to finish before disposing.

type Disposable = { dispose(): void };

export type RetireOptions = {
  /** How often to check whether the other thread has let go. */
  pollMs?: number;
  /** Checks before giving up (pollMs × maxPolls ≈ the longest wait). */
  maxPolls?: number;
  /** setTimeout by default; injectable for tests. */
  schedule?: (callback: () => void, ms: number) => unknown;
  /**
   * Still busy after every check: the resources are left to the garbage collector,
   * never freed while possibly in use.
   */
  onGiveUp?: () => void;
};

/** Disposes `resources` once `isBusy()` is false. Never throws. */
export function retireWhenIdle(
  isBusy: () => boolean,
  resources: readonly Disposable[],
  {
    pollMs = 50,
    maxPolls = 100,
    schedule = setTimeout,
    onGiveUp,
  }: RetireOptions = {},
): void {
  if (resources.length === 0) return;
  let polls = 0;
  const attempt = () => {
    let busy: boolean;
    try {
      busy = isBusy();
    } catch {
      // Cannot tell: treat as busy, and give up (without freeing) if it never answers.
      busy = true;
    }
    if (!busy) {
      disposeQuietly(...resources);
      return;
    }
    if (polls++ >= maxPolls) {
      onGiveUp?.();
      return;
    }
    schedule(attempt, pollMs);
  };
  attempt();
}

/** Disposes each resource on its own; one failing never stops the others or escapes. */
export function disposeQuietly(...resources: readonly Disposable[]): void {
  for (const resource of resources) {
    try {
      resource.dispose();
    } catch {
      /* Already freed, or freed by the garbage collector later. */
    }
  }
}
