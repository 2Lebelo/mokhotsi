import assert from "node:assert/strict";
import test from "node:test";

import {
  isCapabilityFailure,
  isLive,
  ladderFor,
  nextMode,
  startMode,
} from "../src/features/vision/camera-ladder.ts";
import {
  disposeQuietly,
  retireWhenIdle,
} from "../src/features/vision/retire.ts";

test("ladderFor: Android tries GPU frames, then YUV, then photos", () => {
  assert.deepEqual(ladderFor("android", true), [
    "live-native",
    "live-yuv",
    "still",
  ]);
  assert.deepEqual(ladderFor("ios", true), ["live-yuv", "still"]);
  assert.deepEqual(ladderFor("android", false), ["still"]);
  assert.deepEqual(ladderFor("ios", false), ["still"]);
});

test("startMode: remembered mode only for the same build and ladder", () => {
  const ladder = ladderFor("android", true);
  assert.equal(startMode(ladder, null, "1.0.0+A"), "live-native");
  assert.equal(
    startMode(ladder, { mode: "live-yuv", build: "1.0.0+A" }, "1.0.0+A"),
    "live-yuv",
  );
  // An app or OS update probes again from the top.
  assert.equal(
    startMode(ladder, { mode: "live-yuv", build: "1.0.0+A" }, "1.0.1+A"),
    "live-native",
  );
  assert.equal(
    startMode(ladder, { mode: "still", build: "1.0.0+A" }, "1.0.0+B"),
    "live-native",
  );
  // A mode this ladder does not have (e.g. resizer gone) falls back to the top.
  assert.equal(
    startMode(["still"], { mode: "live-yuv", build: "x" }, "x"),
    "still",
  );
  assert.equal(
    startMode(ladder, { mode: "bogus", build: "x" }, "x"),
    "live-native",
  );
});

test("nextMode: steps down one at a time and stops at the last resort", () => {
  const ladder = ladderFor("android", true);
  assert.equal(nextMode(ladder, "live-native"), "live-yuv");
  assert.equal(nextMode(ladder, "live-yuv"), "still");
  assert.equal(nextMode(ladder, "still"), null);
  assert.equal(nextMode(["live-yuv", "still"], "live-native"), null);
});

test("isCapabilityFailure: only format refusals are remembered", () => {
  // Samsung A32 (CameraX ImageAnalysis).
  assert.ok(
    isCapabilityFailure(
      "java.lang.IllegalArgumentException: PRIVATE format with resolution 1280x720 is not supported for ImageAnalysis on the device.",
    ),
  );
  assert.ok(
    isCapabilityFailure("The input AHardwareBuffer is not sampleable from Vulkan."),
  );
  assert.ok(isCapabilityFailure("Frame does not have a HardwareBuffer!"));
  assert.ok(isCapabilityFailure("GPU resizer unavailable: Error: boom"));
  // Transient problems step down for this session only.
  assert.ok(!isCapabilityFailure("No frames within 8000 ms"));
  assert.ok(!isCapabilityFailure("Camera is in use by another app"));
});

test("isLive", () => {
  assert.ok(isLive("live-native"));
  assert.ok(isLive("live-yuv"));
  assert.ok(!isLive("still"));
});

/** A resource that records disposal, and a scheduler the test steps by hand. */
function fixtures() {
  const disposed = [];
  const resource = (name) => ({ dispose: () => disposed.push(name) });
  const queue = [];
  const schedule = (callback) => queue.push(callback);
  const tick = () => queue.shift()?.();
  return { disposed, resource, queue, schedule, tick };
}

test("retireWhenIdle: frees at once when nothing is using the resources", () => {
  const f = fixtures();
  retireWhenIdle(() => false, [f.resource("a"), f.resource("b")], {
    schedule: f.schedule,
  });
  assert.deepEqual(f.disposed, ["a", "b"]);
  assert.equal(f.queue.length, 0);
});

test("retireWhenIdle: waits for the in-flight frame, then frees", () => {
  const f = fixtures();
  let busy = true;
  retireWhenIdle(() => busy, [f.resource("a")], { schedule: f.schedule });
  assert.deepEqual(f.disposed, []);
  f.tick();
  assert.deepEqual(f.disposed, [], "still busy: never freed under the frame");
  busy = false;
  f.tick();
  assert.deepEqual(f.disposed, ["a"]);
  assert.equal(f.queue.length, 0);
});

test("retireWhenIdle: gives up without freeing when the frame never ends", () => {
  const f = fixtures();
  let gaveUp = 0;
  retireWhenIdle(() => true, [f.resource("a")], {
    schedule: f.schedule,
    maxPolls: 3,
    onGiveUp: () => gaveUp++,
  });
  while (f.queue.length) f.tick();
  assert.deepEqual(f.disposed, []);
  assert.equal(gaveUp, 1);
});

test("retireWhenIdle: a busy check that throws counts as busy, never escapes", () => {
  const f = fixtures();
  let gaveUp = 0;
  assert.doesNotThrow(() =>
    retireWhenIdle(
      () => {
        throw new Error("lock gone");
      },
      [f.resource("a")],
      { schedule: f.schedule, maxPolls: 1, onGiveUp: () => gaveUp++ },
    ),
  );
  while (f.queue.length) f.tick();
  assert.deepEqual(f.disposed, []);
  assert.equal(gaveUp, 1);
});

test("disposeQuietly: one failing dispose stops neither the others nor the caller", () => {
  const f = fixtures();
  const failing = {
    dispose() {
      throw new Error("Previous GPUFrame is still active.");
    },
  };
  assert.doesNotThrow(() =>
    disposeQuietly(f.resource("a"), failing, f.resource("b")),
  );
  assert.deepEqual(f.disposed, ["a", "b"]);
});

test("retireWhenIdle: nothing to free schedules nothing", () => {
  const f = fixtures();
  retireWhenIdle(() => true, [], { schedule: f.schedule });
  assert.equal(f.queue.length, 0);
});
