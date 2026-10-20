// All boxes are normalised to the model square: the centred square crop of an
// upright camera frame or photo ('cover'). The detector input and the crop source
// share that square, so a detector box addresses the crop source directly.

export type Box = { x: number; y: number; width: number; height: number };
export type ScoredBox = Box & { score: number };

export function clamp01(value: number): number {
  "worklet";
  return value < 0 ? 0 : value > 1 ? 1 : value;
}

export function boxArea(box: Box): number {
  "worklet";
  return box.width * box.height;
}

export function iou(a: Box, b: Box): number {
  "worklet";
  const x1 = Math.max(a.x, b.x);
  const y1 = Math.max(a.y, b.y);
  const x2 = Math.min(a.x + a.width, b.x + b.width);
  const y2 = Math.min(a.y + a.height, b.y + b.height);
  const inter = Math.max(0, x2 - x1) * Math.max(0, y2 - y1);
  const union = boxArea(a) + boxArea(b) - inter;
  return union > 0 ? inter / union : 0;
}

/**
 * A square region around the box with `pad` context on each side, shifted (not
 * clipped) to stay inside the image, so the embedder never sees a stretched item.
 */
export function squareCrop(box: Box, pad: number): Box {
  "worklet";
  const side = Math.min(1, Math.max(box.width, box.height) * (1 + 2 * pad));
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  const x = Math.min(Math.max(cx - side / 2, 0), 1 - side);
  const y = Math.min(Math.max(cy - side / 2, 0), 1 - side);
  return { x, y, width: side, height: side };
}

/** The pixel rectangle of the centred square ('cover') crop of a width × height image. */
export function centerSquare(width: number, height: number) {
  "worklet";
  const size = Math.min(width, height);
  return {
    x: Math.floor((width - size) / 2),
    y: Math.floor((height - size) / 2),
    size,
  };
}
