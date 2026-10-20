import type { Image } from "react-native-nitro-image";

import {
  centerSquare,
  squareCrop,
  type Box,
  type ScoredBox,
} from "@/ml/geometry";
import { inputShape } from "@/ml/manifest";
import { pixelSource, sampleToTensor } from "@/ml/tensors";
import { l2Normalize } from "@/ml/vector";
import { decodeBestBox, holdBox } from "@/ml/yolo";
import { MANIFEST, PIPELINE } from "@/features/vision/config";
import type { EmbeddedView } from "@/features/vision/types";
import type { VisionModels } from "@/features/vision/vision-service";

const WHOLE: Box = { x: 0, y: 0, width: 1, height: 1 };

function tensorFor(shape: number[]): Float32Array<ArrayBuffer> {
  return new Float32Array(shape.reduce((a, b) => a * b, 1));
}

type Prepared = {
  pixels: ReturnType<typeof pixelSource>;
  box: ScoredBox | null;
};

/** Centre square -> crop source pixels, plus the detected item when `detect` is set. */
async function prepare(
  models: VisionModels,
  image: Image,
  detect: boolean,
): Promise<Prepared> {
  const square = centerSquare(image.width, image.height);
  const source = await (
    await image.cropAsync(
      square.x,
      square.y,
      square.x + square.size,
      square.y + square.size,
    )
  ).resizeAsync(PIPELINE.cropSourceSize, PIPELINE.cropSourceSize);
  const raw = await source.toRawPixelDataAsync();
  const pixels = pixelSource(
    raw.buffer,
    raw.width,
    raw.height,
    raw.pixelFormat,
  );
  if (!detect) return { pixels, box: null };

  const { detector: spec } = MANIFEST;
  const input = tensorFor(inputShape(spec));
  sampleToTensor(
    pixels,
    WHOLE,
    spec.input[0],
    spec.layout,
    spec.input_range,
    input,
  );
  const [output] = await models.detector.run([input.buffer]);
  const best = decodeBestBox(new Float32Array(output), spec.output[0], 0);
  // A single photo has no box on screen yet, so it must reach the show threshold.
  const box = holdBox(best, false, spec.show_threshold, spec.keep_threshold);
  console.log(
    `[vision] still detection score ${best?.score.toFixed(3) ?? "none"} · box ${box ? "used" : "rejected"}`,
  );
  return { pixels, box };
}

/** Embeds one square region of the prepared image. */
async function embedRegion(
  models: VisionModels,
  { pixels, box }: Prepared,
  region: Box,
): Promise<EmbeddedView> {
  const { embedder: spec } = MANIFEST;
  const size = spec.input[0];
  const input = tensorFor(inputShape(spec));
  const rgbx = new Uint8Array(size * size * 4);
  sampleToTensor(
    pixels,
    region,
    size,
    spec.layout,
    spec.input_range,
    input,
    rgbx,
  );
  const [output] = await models.embedder.run([input.buffer]);
  return {
    vector: l2Normalize(new Float32Array(output)),
    box,
    crop: { rgbx, size },
  };
}

/**
 * Embeds an upright still image (a captured frame or a saved crop) with the same
 * preprocessing as the live camera: centre square -> crop source -> detector ->
 * padded square around the item -> embedder.
 *
 * `detect: false` embeds the whole image, for saved crops that already are the item.
 */
export async function embedImage(
  models: VisionModels,
  image: Image,
  { detect }: { detect: boolean },
): Promise<EmbeddedView> {
  const prepared = await prepare(models, image, detect);
  return embedRegion(
    models,
    prepared,
    prepared.box ? squareCrop(prepared.box, PIPELINE.cropPad) : WHOLE,
  );
}

/**
 * Embeds a product photo as several views: the detected item framed tightly and
 * with more context (`PIPELINE.photoCropPads`), so one or two photos cover the
 * framing differences of a live camera. Without a detection, the whole photo.
 */
export async function embedPhotoViews(
  models: VisionModels,
  image: Image,
): Promise<Float32Array[]> {
  const prepared = await prepare(models, image, true);
  const { box } = prepared;
  const regions = box
    ? PIPELINE.photoCropPads.map((pad) => squareCrop(box, pad))
    : [WHOLE];
  const vectors: Float32Array[] = [];
  // Sequential: a model interpreter is not safe to run concurrently.
  for (const region of regions)
    vectors.push((await embedRegion(models, prepared, region)).vector);
  return vectors;
}

const DEGREES = { up: 0, right: 90, down: 180, left: 270 } as const;

/** Rotates a captured photo upright, using the same orientation contract as the GPU resizer. */
export function uprightImage(
  image: Image,
  orientation: keyof typeof DEGREES,
): Promise<Image> {
  const degrees = DEGREES[orientation];
  return degrees === 0 ? Promise.resolve(image) : image.rotateAsync(degrees);
}
