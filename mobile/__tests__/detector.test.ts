import { createDetectionStore } from '@/features/checkout/detectionStore';
import { checkDetectorIO, decodeBest, detectorResizerOptions } from '@/ml/detector';
import { parseManifest, type DetectorSpec } from '@/ml/manifest';

const N = 8400;

/** YOLOv8 output [1, channels, N] channel-major, all zero, with the given anchors filled in. */
function tensor(
  channels: number,
  anchors: { i: number; box: [number, number, number, number]; scores: number[] }[],
) {
  const out = new Float32Array(channels * N);
  for (const { i, box, scores } of anchors) {
    box.forEach((v, k) => (out[k * N + i] = v));
    scores.forEach((s, c) => (out[(4 + c) * N + i] = s));
  }
  return out;
}

const spec: DetectorSpec = {
  file: 'detector.tflite',
  arch: 'yolov8n',
  input: [640, 640, 3],
  layout: 'nchw',
  dtype: 'float32',
  input_range: [0, 1],
  score_threshold: 0.25,
  model_version: 'test',
};

describe('decodeBest', () => {
  it('returns the highest-scoring box as normalised top-left x/y/width/height', () => {
    const out = tensor(5, [
      { i: 10, box: [0.5, 0.5, 0.2, 0.4], scores: [0.6] },
      { i: 8000, box: [0.25, 0.75, 0.1, 0.1], scores: [0.9] },
    ]);
    const box = decodeBest(out, 5, 0.25)!;
    expect(box.score).toBeCloseTo(0.9);
    expect(box.x).toBeCloseTo(0.2);
    expect(box.y).toBeCloseTo(0.7);
    expect(box.width).toBeCloseTo(0.1);
    expect(box.height).toBeCloseTo(0.1);
  });

  it('returns null when nothing beats the threshold', () => {
    expect(decodeBest(tensor(5, [{ i: 3, box: [0.5, 0.5, 1, 1], scores: [0.25] }]), 5, 0.25)).toBeNull();
  });

  it('clamps boxes that overhang the frame (the exporter emits values slightly outside [0, 1])', () => {
    const box = decodeBest(tensor(5, [{ i: 0, box: [0.5, 0.51, 1.001, 1.0008], scores: [0.74] }]), 5, 0.25)!;
    expect(box.x).toBe(0);
    expect(box.y).toBeCloseTo(0.0096, 3);
    expect(box.x + box.width).toBeLessThanOrEqual(1);
    expect(box.y + box.height).toBeLessThanOrEqual(1);
  });

  it('takes the best score across classes for multi-class models', () => {
    const out = tensor(6, [
      { i: 1, box: [0.5, 0.5, 0.2, 0.2], scores: [0.3, 0.4] },
      { i: 2, box: [0.1, 0.1, 0.1, 0.1], scores: [0.8, 0.1] },
    ]);
    expect(decodeBest(out, 6, 0.25)!.score).toBeCloseTo(0.8);
  });
});

describe('checkDetectorIO', () => {
  const io = (input: number[], output: number[], dataType = 'float32' as const) => ({
    inputs: [{ name: 'in', dataType, shape: input }],
    outputs: [{ name: 'out', dataType: 'float32' as const, shape: output }],
  });

  it('accepts the exported model and returns the output channel count', () => {
    expect(checkDetectorIO(io([1, 3, 640, 640], [1, 5, 8400]), spec)).toBe(5);
  });

  it('rejects an NHWC model when the manifest says nchw', () => {
    expect(() => checkDetectorIO(io([1, 640, 640, 3], [1, 5, 8400]), spec)).toThrow(
      'Detector input is [1, 640, 640, 3], manifest expects [1, 3, 640, 640]',
    );
  });

  it('rejects anchor-major or end-to-end outputs', () => {
    expect(() => checkDetectorIO(io([1, 3, 640, 640], [1, 8400, 5]), spec)).toThrow(
      /expected \[1, 4 \+ classes/,
    );
    expect(() => checkDetectorIO(io([1, 3, 640, 640], [1, 300, 6]), spec)).toThrow(
      /expected \[1, 4 \+ classes/,
    );
  });
});

describe('detectorResizerOptions', () => {
  it('maps the manifest layout to the resizer pixel layout', () => {
    expect(detectorResizerOptions(spec)).toEqual({
      width: 640,
      height: 640,
      channelOrder: 'rgb',
      dataType: 'float32',
      scaleMode: 'cover',
      pixelLayout: 'planar',
    });
    expect(detectorResizerOptions({ ...spec, layout: 'nhwc' }).pixelLayout).toBe('interleaved');
  });
});

describe('manifest v2', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const bundled = require('../assets/models/manifest.json') as Record<string, unknown>;

  it('accepts the bundled manifest', () => {
    const m = parseManifest(bundled);
    expect(m.detector.layout).toBe('nchw');
    expect(m.embedder.layout).toBe('nhwc');
  });

  it('requires a layout on every model', () => {
    const detector = { ...(bundled.detector as object), layout: undefined };
    expect(() => parseManifest({ ...bundled, detector })).toThrow('detector.layout must be nhwc or nchw');
  });
});

describe('createDetectionStore', () => {
  it('notifies at once when an item appears, and throttles score-only updates', () => {
    let t = 1000;
    const store = createDetectionStore(() => t);
    const listener = jest.fn();
    store.subscribe(listener);
    const box = { x: 0, y: 0, width: 1, height: 1, score: 0.8 };

    store.publish(box, 20);
    expect(listener).toHaveBeenCalledTimes(1);
    t += 30;
    store.publish({ ...box, score: 0.81 }, 20);
    expect(listener).toHaveBeenCalledTimes(1);
    expect(store.getSnapshot().box?.score).toBe(0.8);
    t += 300;
    store.publish({ ...box, score: 0.82 }, 20);
    expect(listener).toHaveBeenCalledTimes(2);
    t += 10;
    store.publish(null, 20);
    expect(listener).toHaveBeenCalledTimes(3);
    expect(store.getSnapshot().box).toBeNull();
  });
});
