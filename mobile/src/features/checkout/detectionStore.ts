import type { Box } from '@/ml/types';

export interface DetectionSnapshot {
  box: Box | null;
  /** Resize + inference + decode time of the last frame, in ms. */
  latencyMs: number;
  /** Frames analysed per second over the last second. */
  fps: number;
  /** Last per-frame failure (e.g. resizer rejected the pixel format); null once frames succeed again. */
  error: string | null;
}

export interface DetectionStore {
  /** Called from the frame worklet via scheduleOnRN, once per analysed frame. */
  publish(box: Box | null, latencyMs: number): void;
  publishError(message: string): void;
  getSnapshot(): DetectionSnapshot;
  subscribe(listener: () => void): () => void;
}

const EMPTY: DetectionSnapshot = { box: null, latencyMs: 0, fps: 0, error: null };
/** Re-render at most this often unless an item appears or disappears. */
const MIN_NOTIFY_MS = 250;

/**
 * Latest detection result for the HUD (useSyncExternalStore). Frames arrive at camera rate; listeners
 * are only notified when presence changes or every MIN_NOTIFY_MS, so the screen does not re-render 30×/s.
 */
export function createDetectionStore(now: () => number = Date.now): DetectionStore {
  let snapshot = EMPTY;
  let lastNotify = 0;
  let windowStart = now();
  let windowFrames = 0;
  let fps = 0;
  const listeners = new Set<() => void>();

  const notify = (next: DetectionSnapshot, force: boolean) => {
    const t = now();
    if (!force && t - lastNotify < MIN_NOTIFY_MS) return;
    lastNotify = t;
    snapshot = next;
    listeners.forEach((l) => l());
  };

  return {
    publish(box, latencyMs) {
      const t = now();
      windowFrames++;
      if (t - windowStart >= 1000) {
        fps = Math.round((windowFrames * 1000) / (t - windowStart));
        windowStart = t;
        windowFrames = 0;
      }
      const presenceChanged = (box === null) !== (snapshot.box === null) || snapshot.error !== null;
      notify({ box, latencyMs, fps, error: null }, presenceChanged);
    },
    publishError(message) {
      notify({ ...snapshot, error: message }, snapshot.error !== message);
    },
    getSnapshot: () => snapshot,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}
