import { boxArea, iou, type ScoredBox } from "./geometry.ts";

export type StabilityOptions = {
  /** Overlap with the previous box for the item to count as "still". */
  minIou: number;
  /** Consecutive still detections before an embedding is worth computing. */
  frames: number;
  /** Smallest box (fraction of the square) worth embedding; smaller means "move closer". */
  minArea: number;
};

export const DEFAULT_STABILITY: StabilityOptions = {
  minIou: 0.6,
  frames: 3,
  minArea: 0.04,
};

export type Stability = { box: ScoredBox | null; streak: number };

export const UNSTABLE: Stability = { box: null, streak: 0 };

/** Tracks whether the detected item is held still. Pure, so it runs in the frame worklet. */
export function nextStability(
  previous: Stability,
  box: ScoredBox | null,
  options: StabilityOptions,
): Stability {
  "worklet";
  if (!box || boxArea(box) < options.minArea) return { box: null, streak: 0 };
  const still =
    previous.box !== null && iou(previous.box, box) >= options.minIou;
  return { box, streak: still ? previous.streak + 1 : 1 };
}

export function isStable(state: Stability, options: StabilityOptions): boolean {
  "worklet";
  return state.streak >= options.frames;
}
