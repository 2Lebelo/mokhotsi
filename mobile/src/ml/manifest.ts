import { ManifestError } from '@/lib/errors';

import type { TensorShape } from './types';

/**
 * Shape of mobile/assets/models/manifest.json. ml/scripts/_manifest.py writes the same shape;
 * bump `schema_version` on both sides together.
 */
export interface ModelSpec {
  /** File name inside mobile/assets/models/. */
  file: string;
  arch: string;
  /** Height, width, channels. */
  input: TensorShape;
  dtype: 'float32' | 'uint8' | 'int8';
  /** Value range the model expects after preprocessing, e.g. [0, 1] or [-1, 1]. */
  input_range: readonly [number, number];
  model_version: string;
}

export interface DetectorSpec extends ModelSpec {
  score_threshold: number;
}

export interface EmbedderSpec extends ModelSpec {
  dim: number;
}

export interface ModelManifest {
  schema_version: 1;
  detector: DetectorSpec;
  embedder: EmbedderSpec;
  /** Minimum cosine similarity to accept a match (placeholder until eval_matching.py tunes it). */
  match_threshold: number;
}

type Obj = Record<string, unknown>;

function isObj(v: unknown): v is Obj {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function str(o: Obj, key: string, path: string): string {
  const v = o[key];
  if (typeof v !== 'string' || v.length === 0)
    throw new ManifestError(`${path}.${key} must be a non-empty string`);
  return v;
}

function num(o: Obj, key: string, path: string, min = -Infinity, max = Infinity): number {
  const v = o[key];
  if (typeof v !== 'number' || !Number.isFinite(v) || v < min || v > max) {
    throw new ManifestError(`${path}.${key} must be a number in [${min}, ${max}]`);
  }
  return v;
}

function tuple(o: Obj, key: string, path: string, length: number): number[] {
  const v = o[key];
  if (
    !Array.isArray(v) ||
    v.length !== length ||
    !v.every((n) => typeof n === 'number' && Number.isFinite(n))
  ) {
    throw new ManifestError(`${path}.${key} must be an array of ${length} numbers`);
  }
  return v as number[];
}

function modelSpec(raw: unknown, path: string): ModelSpec {
  if (!isObj(raw)) throw new ManifestError(`${path} must be an object`);
  const file = str(raw, 'file', path);
  if (!file.endsWith('.tflite')) throw new ManifestError(`${path}.file must end with .tflite`);
  const [h, w, c] = tuple(raw, 'input', path, 3) as [number, number, number];
  if (![h, w, c].every((n) => Number.isInteger(n) && n > 0)) {
    throw new ManifestError(`${path}.input must be positive integers`);
  }
  const dtype = raw.dtype;
  if (dtype !== 'float32' && dtype !== 'uint8' && dtype !== 'int8') {
    throw new ManifestError(`${path}.dtype must be float32, uint8 or int8`);
  }
  const [lo, hi] = tuple(raw, 'input_range', path, 2) as [number, number];
  if (!(lo < hi)) throw new ManifestError(`${path}.input_range must be [low, high] with low < high`);
  return {
    file,
    arch: str(raw, 'arch', path),
    input: [h, w, c],
    dtype,
    input_range: [lo, hi],
    model_version: str(raw, 'model_version', path),
  };
}

/** Validate untrusted JSON. Throws ManifestError naming the first bad field. */
export function parseManifest(raw: unknown): ModelManifest {
  if (!isObj(raw)) throw new ManifestError('root must be an object');
  if (raw.schema_version !== 1) throw new ManifestError('schema_version must be 1');
  if (!isObj(raw.detector)) throw new ManifestError('detector must be an object');
  if (!isObj(raw.embedder)) throw new ManifestError('embedder must be an object');
  const detector: DetectorSpec = {
    ...modelSpec(raw.detector, 'detector'),
    score_threshold: num(raw.detector, 'score_threshold', 'detector', 0, 1),
  };
  const embedder: EmbedderSpec = {
    ...modelSpec(raw.embedder, 'embedder'),
    dim: num(raw.embedder, 'dim', 'embedder', 1),
  };
  if (!Number.isInteger(embedder.dim)) throw new ManifestError('embedder.dim must be an integer');
  return {
    schema_version: 1,
    detector,
    embedder,
    match_threshold: num(raw, 'match_threshold', 'root', -1, 1),
  };
}

let cached: ModelManifest | undefined;

/** Load and validate the bundled manifest once. */
export function loadManifest(): ModelManifest {
  if (!cached) {
    cached = parseManifest(require('../../assets/models/manifest.json'));
  }
  return cached;
}
