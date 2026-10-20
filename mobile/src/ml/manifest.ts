// The contract between exported models and the app. Every shape, value range,
// and threshold the pipelines use comes from here, never from literals in code.

export type ValueRange = readonly [number, number];
export type TensorLayout = "nchw" | "nhwc";

export type DetectorSpec = {
  file: string;
  arch: string;
  model_version: string;
  /** [height, width, channels] of the image the model sees. */
  input: readonly [number, number, number];
  layout: TensorLayout;
  dtype: "float32";
  input_range: ValueRange;
  /** [channels, anchors]: 4 box rows plus one score row per class. */
  output: readonly [number, number];
  /** Score a new item needs before its box appears. */
  show_threshold: number;
  /** Score below which a box already on screen disappears (≤ show_threshold). */
  keep_threshold: number;
  max_fps: number;
};

export type EmbedderSpec = {
  file: string;
  arch: string;
  /** Stored with every vector; changing it means re-embedding. */
  model_version: string;
  input: readonly [number, number, number];
  layout: TensorLayout;
  dtype: "float32";
  input_range: ValueRange;
  dim: number;
  max_per_second: number;
};

export type MatchingSpec = {
  /** Minimum cosine similarity for a product to be proposed. */
  accept_threshold: number;
  /** Minimum lead of the best product over the runner-up before a match locks. */
  margin: number;
  top_k: number;
};

export type VisionManifest = {
  schema_version: number;
  detector: DetectorSpec;
  embedder: EmbedderSpec;
  matching: MatchingSpec;
};

/** The subset of a loaded TFLite model that IO validation reads. */
export type ModelIO = {
  inputs: { shape: number[]; dataType: string }[];
  outputs: { shape: number[]; dataType: string }[];
};

function fail(path: string, expected: string): never {
  throw new Error(`Invalid model manifest: ${path} must be ${expected}.`);
}

function record(value: unknown, path: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    fail(path, "an object");
  return value as Record<string, unknown>;
}

function text(o: Record<string, unknown>, key: string, path: string): string {
  const value = o[key];
  if (typeof value !== "string" || !value) fail(`${path}.${key}`, "a string");
  return value;
}

function positive(o: Record<string, unknown>, key: string, path: string) {
  const value = o[key];
  if (typeof value !== "number" || !(value > 0))
    fail(`${path}.${key}`, "a positive number");
  return value;
}

function fraction(o: Record<string, unknown>, key: string, path: string) {
  const value = o[key];
  if (typeof value !== "number" || value < 0 || value > 1)
    fail(`${path}.${key}`, "a number from 0 to 1");
  return value;
}

function ints(value: unknown, length: number, path: string): number[] {
  if (
    !Array.isArray(value) ||
    value.length !== length ||
    !value.every((n) => Number.isInteger(n) && n > 0)
  )
    fail(path, `${length} positive integers`);
  return value as number[];
}

function range(value: unknown, path: string): ValueRange {
  if (
    !Array.isArray(value) ||
    value.length !== 2 ||
    typeof value[0] !== "number" ||
    typeof value[1] !== "number" ||
    !(value[1] > value[0])
  )
    fail(path, "[low, high]");
  return [value[0], value[1]];
}

function layout(value: unknown, path: string): TensorLayout {
  if (value !== "nchw" && value !== "nhwc") fail(path, '"nchw" or "nhwc"');
  return value;
}

function float32(value: unknown, path: string): "float32" {
  if (value !== "float32") fail(path, '"float32"');
  return value;
}

export function parseManifest(raw: unknown): VisionManifest {
  const root = record(raw, "manifest");
  const d = record(root.detector, "detector");
  const e = record(root.embedder, "embedder");
  const m = record(root.matching, "matching");
  const [dh, dw, dc] = ints(d.input, 3, "detector.input");
  const [channels, anchors] = ints(d.output, 2, "detector.output");
  if (channels < 5)
    fail("detector.output[0]", "at least 5 (4 box rows + scores)");
  const show = fraction(d, "show_threshold", "detector");
  const keep = fraction(d, "keep_threshold", "detector");
  if (keep > show)
    fail("detector.keep_threshold", "at most detector.show_threshold");
  const [eh, ew, ec] = ints(e.input, 3, "embedder.input");
  const topK = m.top_k;
  if (!Number.isInteger(topK) || (topK as number) < 1)
    fail("matching.top_k", "a positive integer");
  return {
    schema_version: positive(root, "schema_version", "manifest"),
    detector: {
      file: text(d, "file", "detector"),
      arch: text(d, "arch", "detector"),
      model_version: text(d, "model_version", "detector"),
      input: [dh, dw, dc],
      layout: layout(d.layout, "detector.layout"),
      dtype: float32(d.dtype, "detector.dtype"),
      input_range: range(d.input_range, "detector.input_range"),
      output: [channels, anchors],
      show_threshold: show,
      keep_threshold: keep,
      max_fps: positive(d, "max_fps", "detector"),
    },
    embedder: {
      file: text(e, "file", "embedder"),
      arch: text(e, "arch", "embedder"),
      model_version: text(e, "model_version", "embedder"),
      input: [eh, ew, ec],
      layout: layout(e.layout, "embedder.layout"),
      dtype: float32(e.dtype, "embedder.dtype"),
      input_range: range(e.input_range, "embedder.input_range"),
      dim: ints([e.dim], 1, "embedder.dim")[0],
      max_per_second: positive(e, "max_per_second", "embedder"),
    },
    matching: {
      accept_threshold: fraction(m, "accept_threshold", "matching"),
      margin: fraction(m, "margin", "matching"),
      top_k: topK as number,
    },
  };
}

/** The batch-of-one input tensor shape a spec describes. */
export function inputShape(spec: {
  input: readonly number[];
  layout: TensorLayout;
}) {
  const [h, w, c] = spec.input;
  return spec.layout === "nchw" ? [1, c, h, w] : [1, h, w, c];
}

const shapeText = (shape: readonly number[] | undefined) =>
  `[${(shape ?? []).join(", ")}]`;

/**
 * Checks a loaded model against the manifest before it sees any data. A mismatch
 * would otherwise run silently and produce garbage boxes or vectors.
 */
export function assertModelIO(
  name: string,
  model: ModelIO,
  input: readonly number[],
  output: readonly number[],
): void {
  const actualIn = model.inputs[0];
  const actualOut = model.outputs[0];
  const problems: string[] = [];
  if (
    model.inputs.length !== 1 ||
    shapeText(actualIn?.shape) !== shapeText(input)
  )
    problems.push(
      `input ${shapeText(actualIn?.shape)}, expected ${shapeText(input)}`,
    );
  if (actualIn && actualIn.dataType !== "float32")
    problems.push(`input type ${actualIn.dataType}, expected float32`);
  if (
    model.outputs.length !== 1 ||
    shapeText(actualOut?.shape) !== shapeText(output)
  )
    problems.push(
      `output ${shapeText(actualOut?.shape)}, expected ${shapeText(output)}`,
    );
  if (actualOut && actualOut.dataType !== "float32")
    problems.push(`output type ${actualOut.dataType}, expected float32`);
  if (problems.length)
    throw new Error(
      `The ${name} model does not match its manifest: ${problems.join("; ")}.`,
    );
}
