import { MaterialCommunityIcons } from "@expo/vector-icons";
import Constants from "expo-constants";
import * as Device from "expo-device";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Linking,
  Platform,
  StyleSheet,
  Text,
  View,
} from "react-native";
import {
  Camera,
  CommonResolutions,
  useCameraPermission,
  usePhotoOutput,
} from "react-native-vision-camera";
import { isResizerAvailable } from "react-native-vision-camera-resizer";

import {
  Button,
  errorMessage,
  font,
  ui,
  usePalette,
} from "@/components/shop-ui";
import { useDevice } from "@/auth/device-provider";
import { elapsedMs, nowMs } from "@/ml/clock";
import type { ScoredBox } from "@/ml/geometry";
import { useCameraVisibility } from "@/features/scanner/use-camera-visibility";
import {
  isCapabilityFailure,
  ladderFor,
  nextMode,
  startMode,
  type CameraMode,
} from "@/features/vision/camera-ladder";
import { PIPELINE } from "@/features/vision/config";
import {
  disposeImages,
  embedImage,
  uprightImage,
} from "@/features/vision/still-pipeline";
import type { EmbeddedView } from "@/features/vision/types";
import {
  useLivePipeline,
  type LiveDetection,
} from "@/features/vision/use-live-pipeline";
import type { VisionModels } from "@/features/vision/vision-service";

export type { CameraMode } from "@/features/vision/camera-ladder";

/** A remembered step down holds until the app or the phone's OS (and its drivers) change. */
const MODE_BUILD = `${Constants.expoConfig?.version ?? "dev"}+${Device.osBuildId ?? "unknown"}`;

function resizerAvailable(): boolean {
  try {
    return isResizerAvailable();
  } catch {
    return false;
  }
}

/**
 * The camera mode for this phone (see camera-ladder). Live recognition needs the GPU
 * resizer (Vulkan on Android); without it, or when the phone refuses both live
 * formats, the same models run on single captured photos instead. `__DEV__` builds
 * can force the still fallback to test it on any phone.
 */
export function useCameraMode(forceStill = false) {
  const { device } = useDevice();
  const [ladder] = useState(() =>
    ladderFor(Platform.OS, !forceStill && resizerAvailable()),
  );
  const [mode, setMode] = useState(() =>
    startMode(ladder, device.visionCameraMode(), MODE_BUILD),
  );
  const current = useRef(mode);

  /** `from` failed before it ever worked: move to the next mode down. */
  const demote = useCallback(
    (from: CameraMode, reason: string) => {
      // A late report from a camera already replaced, or a second failure of the same one.
      if (from !== current.current) return;
      const next = nextMode(ladder, from);
      if (!next) return;
      const remembered = isCapabilityFailure(reason);
      if (__DEV__)
        console.log(
          `[vision] camera ${from} → ${next}${remembered ? " (remembered)" : ""}: ${reason}`,
        );
      if (remembered)
        device.setVisionCameraMode({ mode: next, build: MODE_BUILD });
      current.current = next;
      setMode(next);
    },
    [ladder, device],
  );

  return { mode, demote };
}

/** Native camera errors carry Java stack traces; the cashier gets a sentence instead. */
function cameraFailure(error: Error): string {
  if (__DEV__) console.log(`[vision] camera error: ${error.message}`);
  return "The camera couldn't start. Close this screen and try again, or search instead.";
}

type Props = {
  models: VisionModels;
  mode: CameraMode;
  /** False while a sheet is open: live processing pauses, captures are disabled. */
  active: boolean;
  onView: (view: EmbeddedView) => void;
  onDetection?: (detection: LiveDetection) => void;
  onError: (message: string) => void;
  /** `mode` failed before processing a single frame: step down (see useCameraMode). */
  onUnsupported: (mode: CameraMode, reason: string) => void;
  /** Label of the capture button in still mode. */
  captureLabel: string;
  /** An item is being identified: shows a spinner over the preview. */
  identifying?: boolean;
};

/**
 * A square camera: with 'cover' scaling the preview shows exactly the centre
 * square the models see, so the guide and detection boxes need no mapping.
 */
export function VisionCameraView(props: Props) {
  const { hasPermission } = useCameraPermission();
  if (!hasPermission)
    return <CameraPermission purpose="to identify products" />;
  // Keyed by mode: stepping down mounts a fresh camera session rather than
  // reconfiguring the one that failed.
  return props.mode === "still" ? (
    <StillCamera {...props} />
  ) : (
    <LiveCamera key={props.mode} {...props} />
  );
}

/** Shown in place of a VisionCamera preview until the camera is allowed. */
export function CameraPermission({ purpose }: { purpose: string }) {
  const c = usePalette();
  const { canRequestPermission, requestPermission } = useCameraPermission();
  return (
    <View
      style={[styles.square, styles.center, { backgroundColor: c.surface }]}
    >
      <MaterialCommunityIcons name="camera-outline" size={32} color={c.accent} />
      <Text style={[ui.body, { color: c.text, textAlign: "center" }]}>
        {canRequestPermission
          ? `Allow camera access ${purpose}.`
          : "Camera access is off for Mokhotsi. Turn it on in your phone settings."}
      </Text>
      <Button
        title={canRequestPermission ? "Allow camera" : "Open settings"}
        onPress={() =>
          canRequestPermission
            ? void requestPermission()
            : void Linking.openSettings()
        }
      />
    </View>
  );
}

/** The framing guide drawn over a square preview. */
export function CameraGuide() {
  return <Guide box={null} stable={false} />;
}

function LiveCamera({
  models,
  mode,
  active,
  onView,
  onDetection,
  onError,
  onUnsupported,
  identifying = false,
}: Props) {
  const visible = useCameraVisibility();
  const [box, setBox] = useState<ScoredBox | null>(null);
  const [stable, setStable] = useState(false);
  // Until a frame has made it through the detector, a failure means this phone cannot
  // run this mode; after that, failures are reported as usual.
  const proven = useRef(false);
  const pipeline = useLivePipeline(
    models,
    mode === "live-native" ? "native" : "yuv",
    {
      onDetection(detection) {
        proven.current = true;
        setBox(detection.box);
        setStable(detection.stable);
        onDetection?.(detection);
      },
      onView,
      onError,
      onUnsupported: (reason) => onUnsupported(mode, reason),
    },
  );
  const { setPaused, frameOutput } = pipeline;
  // A stable outputs array, so detections re-rendering this view never reconfigure the session.
  const outputs = useMemo(() => [frameOutput], [frameOutput]);
  useEffect(() => {
    // Keep the camera thread in step with sheets opening and closing.
    setPaused(!active);
  }, [active, setPaused]);
  useEffect(() => {
    // Some phones accept the format but never deliver a frame: step down rather than
    // show a black square forever. Only counts while the camera is meant to be running.
    if (!active || !visible || proven.current) return;
    const timer = setTimeout(() => {
      if (!proven.current)
        onUnsupported(mode, `No frames within ${PIPELINE.liveStartTimeoutMs} ms`);
    }, PIPELINE.liveStartTimeoutMs);
    return () => clearTimeout(timer);
  }, [active, visible, mode, onUnsupported]);
  return (
    <View style={styles.square}>
      <Camera
        style={StyleSheet.absoluteFill}
        device="back"
        isActive={visible}
        outputs={outputs}
        resizeMode="cover"
        onError={(error) =>
          proven.current
            ? onError(cameraFailure(error))
            : onUnsupported(mode, error.message)
        }
      />
      <Guide box={active ? box : null} stable={stable} />
      {active && identifying && <IdentifyingOverlay />}
    </View>
  );
}

function StillCamera({
  models,
  active,
  onView,
  onError,
  captureLabel,
  identifying = false,
}: Props) {
  const visible = useCameraVisibility();
  // The pipeline only needs a 448 px square; the default (4000 × 3000) costs ~48 MB a shot.
  const photoOutput = usePhotoOutput({
    targetResolution: CommonResolutions.HD_4_3,
    qualityPrioritization: "speed",
  });
  const outputs = useMemo(() => [photoOutput], [photoOutput]);
  const [busy, setBusy] = useState(false);

  async function capture() {
    setBusy(true);
    const owned: { dispose(): void }[] = [];
    try {
      const captureStart = nowMs();
      const photo = await photoOutput.capturePhoto(
        { enableShutterSound: false },
        {},
      );
      owned.push(photo);
      const captureMs = elapsedMs(captureStart);
      const decodeStart = nowMs();
      const decoded = await photo.toImageAsync();
      owned.push(decoded);
      const image = await uprightImage(decoded, photo.orientation);
      owned.push(image);
      const decodeMs = elapsedMs(decodeStart);
      const view = await embedImage(models, image, { detect: true });
      onView({ ...view, timing: { ...view.timing, captureMs, decodeMs } });
    } catch (cause) {
      onError(errorMessage(cause));
    } finally {
      disposeImages(...owned);
      setBusy(false);
    }
  }

  return (
    <View style={ui.stack}>
      <View style={styles.square}>
        <Camera
          style={StyleSheet.absoluteFill}
          device="back"
          isActive={visible}
          outputs={outputs}
          resizeMode="cover"
          onError={(error) => onError(cameraFailure(error))}
        />
        <Guide box={null} stable={false} />
        {(busy || (active && identifying)) && <IdentifyingOverlay />}
      </View>
      <Button
        title={captureLabel}
        busy={busy}
        disabled={!active}
        onPress={() => void capture()}
      />
    </View>
  );
}

/** A spinner over the preview while the camera works out what the item is. */
function IdentifyingOverlay() {
  return (
    <View
      pointerEvents="none"
      style={[StyleSheet.absoluteFill, styles.overlay]}
    >
      <View
        accessible
        accessibilityRole="progressbar"
        accessibilityLabel="Identifying the item"
        accessibilityLiveRegion="polite"
        style={styles.pill}
      >
        <ActivityIndicator color="#FFFFFF" />
        <Text style={styles.pillText}>Identifying…</Text>
      </View>
    </View>
  );
}

function Guide({ box, stable }: { box: ScoredBox | null; stable: boolean }) {
  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFill}>
      <View style={styles.guide} />
      {box && (
        <View
          style={[
            styles.box,
            {
              left: `${box.x * 100}%`,
              top: `${box.y * 100}%`,
              width: `${box.width * 100}%`,
              height: `${box.height * 100}%`,
              borderColor: stable ? "#4ADE80" : "#FFFFFF",
            },
          ]}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  square: {
    width: "100%",
    aspectRatio: 1,
    borderRadius: 24,
    overflow: "hidden",
    backgroundColor: "#000",
  },
  center: {
    alignItems: "center",
    justifyContent: "center",
    padding: 24,
    gap: 14,
  },
  guide: {
    position: "absolute",
    inset: 12,
    borderWidth: 2,
    borderRadius: 18,
    borderColor: "rgba(255,255,255,0.35)",
  },
  box: { position: "absolute", borderWidth: 3, borderRadius: 10 },
  overlay: {
    alignItems: "center",
    justifyContent: "flex-end",
    paddingBottom: 20,
  },
  pill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderRadius: 22,
    backgroundColor: "rgba(15,20,25,0.72)",
  },
  pillText: { ...font.medium, color: "#FFFFFF", fontSize: 14 },
});
