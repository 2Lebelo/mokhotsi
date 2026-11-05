// How the identify camera runs on this phone, best first. Whether a phone can hand GPU
// (PRIVATE) frames to CameraX's ImageAnalysis depends on its graphics driver and cannot be
// asked in advance (e.g. Samsung A32 / Mali-G52 refuses them), so the camera starts at the
// best mode it may run, steps down when a mode fails before it has worked, and remembers a
// step down only when the phone said it cannot do the format: a busy camera or a slow start
// must not slow this phone down for good.

export type CameraMode =
  /** Android: opaque GPU frames into the Vulkan resizer (fastest). */
  | "live-native"
  /** YUV frames into the GPU resizer (iOS always; Android when GPU frames are refused). */
  | "live-yuv"
  /** One captured photo at a time; works on every phone. */
  | "still";

/** The best mode this phone can run, and the app + OS build that was learned on. */
export type RememberedCameraMode = { mode: CameraMode; build: string };

export function ladderFor(
  platform: string,
  resizerAvailable: boolean,
): CameraMode[] {
  if (!resizerAvailable) return ["still"];
  return platform === "android"
    ? ["live-native", "live-yuv", "still"]
    : ["live-yuv", "still"];
}

/**
 * Where to start: the remembered mode, unless it was learned on another app or OS build
 * (a driver or camera library update may change what works), then the top of the ladder.
 */
export function startMode(
  ladder: readonly CameraMode[],
  remembered: RememberedCameraMode | null,
  build: string,
): CameraMode {
  if (
    remembered &&
    remembered.build === build &&
    ladder.includes(remembered.mode)
  )
    return remembered.mode;
  return ladder[0] ?? "still";
}

/** The next mode down, or null when `current` is already the last resort. */
export function nextMode(
  ladder: readonly CameraMode[],
  current: CameraMode,
): CameraMode | null {
  const index = ladder.indexOf(current);
  return index >= 0 && index + 1 < ladder.length ? ladder[index + 1] : null;
}

// CameraX ("PRIVATE format … is not supported for ImageAnalysis"), VisionCamera ("Frame does
// not have a HardwareBuffer", "only available on API 28") and the Vulkan resizer ("not
// sampleable", "Vulkan …", "GPU resizer unavailable") refusing the format itself.
const CAPABILITY_FAILURE =
  /not supported|unsupported|sampleable|HardwareBuffer|Vulkan|resizer unavailable|only available/i;

/** Whether a failure says the phone cannot run the mode at all (worth remembering). */
export function isCapabilityFailure(message: string): boolean {
  return CAPABILITY_FAILURE.test(message);
}

export function isLive(mode: CameraMode): boolean {
  return mode !== "still";
}
