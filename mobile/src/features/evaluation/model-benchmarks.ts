import { nowMs } from "@/ml/clock";
import { inputShape } from "@/ml/manifest";
import { pixelSource, sampleToTensor } from "@/ml/tensors";
import { l2Normalize } from "@/ml/vector";
import type { VectorIndex } from "@/ml/vector-index";
import { benchmark } from "@/features/evaluation/benchmark";
import { EVALUATION } from "@/features/evaluation/config";
import type { BenchmarkResult } from "@/features/evaluation/run";
import { MANIFEST, PIPELINE } from "@/features/vision/config";
import type { VisionModels } from "@/features/vision/vision-service";

function filled(shape: number[], value: number): Float32Array<ArrayBuffer> {
  return new Float32Array(shape.reduce((a, b) => a * b, 1)).fill(value);
}

/**
 * Times each stage of recognition on its own, on fixed input, with no camera running: pure
 * inference and matching cost, free of the pipeline's deliberate throttling (detector frame
 * rate, embeddings per second, stability frames, voting). The caller must make sure no camera
 * is using the models: an interpreter is not safe to run concurrently.
 */
export async function runModelBenchmarks(
  models: VisionModels,
  index: VectorIndex,
  onProgress: (label: string, done: number, total: number) => void,
): Promise<BenchmarkResult[]> {
  const options = (label: string) => ({
    warmup: EVALUATION.benchmarkWarmup,
    iterations: EVALUATION.benchmarkIterations,
    now: nowMs,
    at: () => new Date().toISOString(),
    onProgress: (done: number, total: number) => onProgress(label, done, total),
  });
  const { detector, embedder } = MANIFEST;
  const results: BenchmarkResult[] = [];

  // Inference time of these CNNs does not depend on the pixel values.
  const detectorInput = filled(inputShape(detector), 0.5);
  results.push(
    await benchmark(
      "detector_inference",
      `${detector.model_version} on ${models.accelerator}, ${detector.input[0]}×${detector.input[1]} input, one run() call`,
      () => models.detector.run([detectorInput.buffer]),
      options("Detector"),
    ),
  );

  const embedderInput = filled(inputShape(embedder), 0);
  results.push(
    await benchmark(
      "embedder_inference",
      `${embedder.model_version} on ${models.accelerator}, ${embedder.input[0]}×${embedder.input[1]} input, one run() call`,
      () => models.embedder.run([embedderInput.buffer]),
      options("Embedder"),
    ),
  );

  // Preprocessing on the CPU: sampling the 224 px embedder input from the 448 px crop source.
  const sourceSize = PIPELINE.cropSourceSize;
  const sourceBytes = new Uint8Array(sourceSize * sourceSize * 3);
  for (let i = 0; i < sourceBytes.length; i++) sourceBytes[i] = (i * 31) & 255;
  const source = pixelSource(sourceBytes.buffer, sourceSize, sourceSize, "RGB");
  const size = embedder.input[0];
  const sampled = new Float32Array(size * size * 3);
  results.push(
    await benchmark(
      "embedder_preprocess",
      `Bilinear sampling of a ${size}×${size} input from the ${sourceSize}×${sourceSize} crop source (JS)`,
      () =>
        sampleToTensor(
          source,
          { x: 0.1, y: 0.1, width: 0.8, height: 0.8 },
          size,
          embedder.layout,
          embedder.input_range,
          sampled,
        ),
      options("Preprocessing"),
    ),
  );

  // Matching against this shop's real index.
  const query = new Float32Array(embedder.dim);
  for (let i = 0; i < query.length; i++) query[i] = Math.sin(i * 12.9898) + 0.1;
  l2Normalize(query);
  if (index.size > 0)
    results.push(
      await benchmark(
        "matching_topk",
        `Cosine top-${MANIFEST.matching.top_k} over ${index.size} stored views (int8, ${embedder.dim} dims, JS)`,
        () => index.topK(query, MANIFEST.matching.top_k),
        options("Matching"),
      ),
    );

  return results;
}
