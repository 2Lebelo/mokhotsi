import type { ScoredBox } from "./geometry.ts";

/**
 * The single best box in a YOLOv8 output tensor `[1, channels, anchors]`
 * (channel-major: cx, cy, w, h rows, then one score row per class, coordinates
 * normalised to the model input). Only one item is wanted, and the best box after
 * NMS is always the raw arg-max, so no NMS runs. Allocation-free except the result.
 */
export function decodeBestBox(
  out: Float32Array,
  channels: number,
  threshold: number,
): ScoredBox | null {
  "worklet";
  const anchors = out.length / channels;
  let best = -1;
  let bestScore = threshold;
  for (let row = 4; row < channels; row++) {
    const offset = row * anchors;
    for (let i = 0; i < anchors; i++) {
      const score = out[offset + i];
      if (score > bestScore) {
        bestScore = score;
        best = i;
      }
    }
  }
  if (best < 0) return null;
  const cx = out[best];
  const cy = out[anchors + best];
  const halfW = out[2 * anchors + best] / 2;
  const halfH = out[3 * anchors + best] / 2;
  const x = Math.max(0, cx - halfW);
  const y = Math.max(0, cy - halfH);
  return {
    x,
    y,
    width: Math.max(0, Math.min(1, cx + halfW) - x),
    height: Math.max(0, Math.min(1, cy + halfH) - y),
    score: bestScore,
  };
}

/**
 * Score hysteresis for the one box on screen: a new item must reach `show` to
 * appear, and a box already shown stays until it drops below `keep`, so a score
 * hovering around a single threshold doesn't make the box flicker.
 */
export function holdBox(
  best: ScoredBox | null,
  shown: boolean,
  show: number,
  keep: number,
): ScoredBox | null {
  "worklet";
  if (!best) return null;
  return best.score >= (shown ? keep : show) ? best : null;
}
