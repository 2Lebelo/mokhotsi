import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { centerSquare, iou, squareCrop } from "../src/ml/geometry.ts";
import {
  assertModelIO,
  inputShape,
  parseManifest,
} from "../src/ml/manifest.ts";
import {
  DEFAULT_STABILITY,
  isStable,
  nextStability,
  UNSTABLE,
} from "../src/ml/stability.ts";
import { pixelSource, sampleToTensor } from "../src/ml/tensors.ts";
import { fromBlob, l2Normalize, toBlob } from "../src/ml/vector.ts";
import { VectorIndex } from "../src/ml/vector-index.ts";
import { MatchVoter } from "../src/ml/voter.ts";
import { decodeBestBox, holdBox } from "../src/ml/yolo.ts";

const bundled = JSON.parse(
  readFileSync(
    new URL("../assets/models/manifest.json", import.meta.url),
    "utf8",
  ),
);

test("the bundled manifest is valid and describes the inspected models", () => {
  const manifest = parseManifest(bundled);
  assert.deepEqual(inputShape(manifest.detector), [1, 3, 320, 320]);
  assert.deepEqual(manifest.detector.output, [5, 2100]);
  assert.deepEqual(inputShape(manifest.embedder), [1, 224, 224, 3]);
  assert.deepEqual(manifest.embedder.input_range, [-1, 1]);
  assert.equal(manifest.embedder.dim, 1280);
  assert.equal(manifest.detector.show_threshold, 0.6);
  assert.equal(manifest.detector.keep_threshold, 0.4);
});

test("invalid manifests and mismatched models are rejected with the reason", () => {
  const broken = structuredClone(bundled);
  broken.embedder.layout = "hwc";
  assert.throws(() => parseManifest(broken), /embedder.layout/);
  const noScores = structuredClone(bundled);
  noScores.detector.output = [4, 2100];
  assert.throws(() => parseManifest(noScores), /at least 5/);
  const inverted = structuredClone(bundled);
  inverted.detector.keep_threshold = 0.7;
  assert.throws(() => parseManifest(inverted), /keep_threshold/);
  const model = (input, output, dataType = "float32") => ({
    inputs: [{ shape: input, dataType }],
    outputs: [{ shape: output, dataType: "float32" }],
  });
  assertModelIO(
    "detector",
    model([1, 3, 320, 320], [1, 5, 2100]),
    [1, 3, 320, 320],
    [1, 5, 2100],
  );
  assert.throws(
    () =>
      assertModelIO(
        "detector",
        model([1, 320, 320, 3], [1, 5, 2100]),
        [1, 3, 320, 320],
        [1, 5, 2100],
      ),
    /input \[1, 320, 320, 3\], expected \[1, 3, 320, 320\]/,
  );
  assert.throws(
    () =>
      assertModelIO(
        "embedder",
        model([1, 224, 224, 3], [1, 1280], "uint8"),
        [1, 224, 224, 3],
        [1, 1280],
      ),
    /input type uint8/,
  );
});

test("YOLO decoding returns the best box above the threshold, clipped to the square", () => {
  const anchors = 4;
  const out = new Float32Array(5 * anchors);
  const set = (anchor, cx, cy, w, h, score) => {
    out[anchor] = cx;
    out[anchors + anchor] = cy;
    out[2 * anchors + anchor] = w;
    out[3 * anchors + anchor] = h;
    out[4 * anchors + anchor] = score;
  };
  set(0, 0.5, 0.5, 0.2, 0.2, 0.3);
  set(2, 0.9, 0.5, 0.4, 0.2, 0.8);
  const box = decodeBestBox(out, 5, 0.35);
  assert.equal(box.score.toFixed(2), "0.80");
  assert.equal(box.x.toFixed(2), "0.70");
  assert.equal(box.width.toFixed(2), "0.30");
  assert.equal(box.y.toFixed(2), "0.40");
  assert.equal(decodeBestBox(out, 5, 0.9), null);
  assert.equal(
    decodeBestBox(out, 5, 0).score.toFixed(2),
    "0.80",
    "threshold 0 always returns the best candidate",
  );
});

test("a box appears at the show threshold and stays until it drops below keep", () => {
  const scored = (score) => ({ x: 0, y: 0, width: 1, height: 1, score });
  const [show, keep] = [0.6, 0.4];
  assert.equal(
    holdBox(scored(0.5), false, show, keep),
    null,
    "too weak to appear",
  );
  assert.equal(holdBox(scored(0.6), false, show, keep).score, 0.6);
  assert.equal(holdBox(scored(0.5), true, show, keep).score, 0.5, "kept");
  assert.equal(holdBox(scored(0.39), true, show, keep), null, "dropped");
  assert.equal(holdBox(null, true, show, keep), null);
});

test("geometry: overlap, square crops kept inside the image, and the centre square", () => {
  const a = { x: 0, y: 0, width: 0.5, height: 0.5 };
  assert.equal(iou(a, a), 1);
  assert.equal(iou(a, { x: 0.5, y: 0.5, width: 0.5, height: 0.5 }), 0);
  const crop = squareCrop({ x: 0.9, y: 0.4, width: 0.1, height: 0.3 }, 0.1);
  assert.equal(crop.width.toFixed(2), "0.36");
  assert.equal(crop.width, crop.height);
  assert.ok(crop.x + crop.width <= 1 + 1e-9);
  assert.deepEqual(centerSquare(1920, 1080), { x: 420, y: 0, size: 1080 });
});

test("tensors are sampled in the right layout, channel order, and value range", () => {
  // 2×1 BGRA image: left pixel pure red, right pixel pure blue.
  const bgra = new Uint8Array([0, 0, 255, 255, 255, 0, 0, 255]);
  const src = pixelSource(bgra.buffer, 2, 1, "BGRA");
  const whole = { x: 0, y: 0, width: 1, height: 1 };

  const nhwc = new Float32Array(2 * 2 * 3);
  const rgbx = new Uint8Array(2 * 2 * 4);
  sampleToTensor(
    src,
    { x: 0, y: 0, width: 0.5, height: 1 },
    2,
    "nhwc",
    [-1, 1],
    nhwc,
    rgbx,
  );
  assert.deepEqual(
    [...nhwc.slice(0, 3)],
    [1, -1, -1],
    "red, mapped to [-1, 1]",
  );
  assert.deepEqual([...rgbx.slice(0, 4)], [255, 0, 0, 255]);

  const nchw = new Float32Array(3 * 2 * 2);
  sampleToTensor(src, whole, 2, "nchw", [0, 1], nchw);
  // Plane order R, G, B; the left column is red, the right column blue.
  assert.equal(nchw[0], 1);
  assert.equal(nchw[8 + 1], 1);
  assert.equal(nchw[4], 0);
  assert.throws(() => pixelSource(bgra.buffer, 2, 1, "YUV"), /Unsupported/);
  assert.throws(() => pixelSource(bgra.buffer, 3, 1, "BGRA"), /needs 12/);
});

test("padded rows are skipped using the buffer's row stride", () => {
  // 1×2 RGBA image with 4 padding bytes per row: top red, bottom green.
  const padded = new Uint8Array([
    255, 0, 0, 255, 9, 9, 9, 9, 0, 255, 0, 255, 9, 9, 9, 9,
  ]);
  const src = pixelSource(padded.buffer, 1, 2, "RGBA", 8);
  const out = new Float32Array(3 * 2);
  sampleToTensor(
    src,
    { x: 0, y: 0, width: 1, height: 1 },
    1,
    "nchw",
    [0, 1],
    out,
  );
  // A 1×1 output averages both rows; padding (9s) would make blue non-zero.
  assert.deepEqual([...out.slice(0, 3)], [0.5, 0.5, 0]);
  // The last row needs no trailing padding.
  assert.doesNotThrow(() =>
    pixelSource(padded.buffer.slice(0, 12), 1, 2, "RGBA", 8),
  );
  assert.throws(() => pixelSource(padded.buffer, 3, 2, "RGBA", 8), /shorter/);
});

test("vectors are normalised and survive the SQLite blob round trip", () => {
  const vector = l2Normalize(new Float32Array([3, 4]));
  assert.deepEqual([...vector], [0.6000000238418579, 0.800000011920929]);
  assert.deepEqual([...fromBlob(toBlob(vector))], [...vector]);
  assert.throws(() => fromBlob(new Uint8Array(3)), /corrupt/);
});

test("the vector index ranks products by their closest view and grows", () => {
  const index = new VectorIndex(2, 1);
  const unit = (x, y) => l2Normalize(new Float32Array([x, y]));
  index.add("sugar", unit(1, 0));
  index.add("sugar", unit(0.8, 0.6));
  index.add("milk", unit(0, 1));
  index.add("bread", unit(-1, 0));
  assert.equal(index.size, 4);
  const ranking = index.topK(unit(0.7, 0.7), 2);
  assert.deepEqual(
    ranking.map((c) => c.productId),
    ["sugar", "milk"],
  );
  assert.ok(ranking[0].score > 0.98);
  assert.throws(() => index.add("x", new Float32Array(3)), /expects 2/);
});

test("stability needs consecutive overlapping boxes of a useful size", () => {
  const box = (x) => ({ x, y: 0.3, width: 0.4, height: 0.4, score: 0.9 });
  let state = UNSTABLE;
  for (const x of [0.3, 0.31, 0.32])
    state = nextStability(state, box(x), DEFAULT_STABILITY);
  assert.equal(isStable(state, DEFAULT_STABILITY), true);
  state = nextStability(state, box(0.6), DEFAULT_STABILITY);
  assert.equal(state.streak, 1, "a jump restarts the streak");
  state = nextStability(
    state,
    { ...box(0.3), width: 0.1, height: 0.1 },
    DEFAULT_STABILITY,
  );
  assert.deepEqual(state, UNSTABLE, "too small to embed");
  assert.deepEqual(nextStability(state, null, DEFAULT_STABILITY), UNSTABLE);
});

test("the voter locks only on repeated, confident, clear wins", () => {
  const voter = new MatchVoter({ accept_threshold: 0.6, margin: 0.05 });
  const rank = (top, score, second = 0.1) => [
    { productId: top, score },
    { productId: "other", score: second },
  ];
  assert.equal(voter.push(rank("sugar", 0.8)), null, "one win is not enough");
  assert.equal(voter.push(rank("sugar", 0.5)), null, "below threshold");
  assert.equal(voter.push(rank("sugar", 0.8)), "sugar", "2 of the last 3");
  voter.reset();
  voter.push(rank("sugar", 0.8, 0.78));
  assert.equal(voter.push(rank("sugar", 0.8, 0.78)), null, "no clear lead");
  assert.equal(voter.push([]), null);
});

test("the identify flow pauses while deciding and only teaches fresh corrections", async () => {
  const { identifyReducer, initialIdentifyState, isCorrection, isProcessing } =
    await import("../src/features/vision/identify-reducer.ts");
  const view = {
    vector: new Float32Array([1, 0]),
    box: null,
    crop: { rgbx: new Uint8Array(4), size: 1 },
  };
  const ranking = [
    { productId: "sugar", score: 0.9 },
    { productId: "salt", score: 0.7 },
  ];
  let state = identifyReducer(initialIdentifyState, {
    type: "matched",
    view,
    ranking,
    locked: false,
    at: 1000,
  });
  assert.equal(isProcessing(state), true, "an unlocked match keeps scanning");
  state = identifyReducer(state, { type: "show-matches" });
  assert.deepEqual(state.sheet, { kind: "matches", confident: false });
  assert.equal(isProcessing(state), false);
  const ignored = identifyReducer(state, {
    type: "matched",
    view,
    ranking: [],
    locked: true,
    at: 1100,
  });
  assert.equal(ignored, state, "no new matches while the cashier decides");

  assert.equal(
    isCorrection(state, "sugar", 2000),
    false,
    "picking the best guess confirms it",
  );
  assert.equal(isCorrection(state, "salt", 2000), true);
  assert.equal(
    isCorrection(state, "salt", 1000 + 60_000),
    false,
    "a stale view teaches nothing",
  );

  state = identifyReducer(state, { type: "choose-size", productId: "sugar" });
  assert.deepEqual(state.sheet, { kind: "size", productId: "sugar" });
  state = identifyReducer(state, { type: "retry" });
  assert.deepEqual(state, initialIdentifyState);
  assert.equal(
    identifyReducer(state, { type: "show-matches" }),
    state,
    "nothing to show yet",
  );
});

test("the identify spinner shows only while a held-still item is being matched", async () => {
  const { identifyReducer, initialIdentifyState, isIdentifying } =
    await import("../src/features/vision/identify-reducer.ts");
  const box = { x: 0.3, y: 0.3, width: 0.4, height: 0.4, score: 0.9 };
  const detected = (state, detection) =>
    identifyReducer(state, {
      type: "detected",
      detection: { score: 0.9, latencyMs: 10, ...detection },
    });
  assert.equal(isIdentifying(initialIdentifyState), false);
  assert.equal(
    isIdentifying(detected(initialIdentifyState, { box, stable: false })),
    false,
    "not while the item is still moving",
  );
  let state = detected(initialIdentifyState, { box, stable: true });
  assert.equal(isIdentifying(state), true);
  assert.equal(
    isIdentifying(detected(state, { box: null, stable: false })),
    false,
    "not once the item has left",
  );
  state = identifyReducer(state, {
    type: "matched",
    view: {
      vector: new Float32Array([1, 0]),
      box,
      crop: { rgbx: new Uint8Array(4), size: 1 },
    },
    ranking: [{ productId: "sugar", score: 0.9 }],
    locked: true,
    at: 1000,
  });
  assert.equal(isIdentifying(state), false, "hidden once the matches show");
});
