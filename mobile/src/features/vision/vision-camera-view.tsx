import { MaterialCommunityIcons } from "@expo/vector-icons";
import { useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Linking,
  StyleSheet,
  Text,
  View,
} from "react-native";
import {
  Camera,
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
import type { ScoredBox } from "@/ml/geometry";
import { useCameraVisibility } from "@/features/scanner/use-camera-visibility";
import { embedImage, uprightImage } from "@/features/vision/still-pipeline";
import type { EmbeddedView } from "@/features/vision/types";
import {
  useLivePipeline,
  type LiveDetection,
} from "@/features/vision/use-live-pipeline";
import type { VisionModels } from "@/features/vision/vision-service";

export type CameraMode = "live" | "still";

/**
 * Live recognition needs the GPU resizer (Vulkan on Android). Without it, the
 * same models run on single captured photos instead. `__DEV__` builds can force
 * the fallback to test it on any phone.
 */
export function cameraModeFor(forceStill = false): CameraMode {
  try {
    return !forceStill && isResizerAvailable() ? "live" : "still";
  } catch {
    return "still";
  }
}

type Props = {
  models: VisionModels;
  mode: CameraMode;
  /** False while a sheet is open: live processing pauses, captures are disabled. */
  active: boolean;
  onView: (view: EmbeddedView) => void;
  onDetection?: (detection: LiveDetection) => void;
  onError: (message: string) => void;
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
  const c = usePalette();
  const { hasPermission, canRequestPermission, requestPermission } =
    useCameraPermission();
  if (!hasPermission)
    return (
      <View
        style={[styles.square, styles.center, { backgroundColor: c.surface }]}
      >
        <MaterialCommunityIcons
          name="camera-outline"
          size={32}
          color={c.accent}
        />
        <Text style={[ui.body, { color: c.text, textAlign: "center" }]}>
          {canRequestPermission
            ? "Allow camera access to identify products."
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
  return props.mode === "live" ? (
    <LiveCamera {...props} />
  ) : (
    <StillCamera {...props} />
  );
}

function LiveCamera({
  models,
  active,
  onView,
  onDetection,
  onError,
  identifying = false,
}: Props) {
  const visible = useCameraVisibility();
  const [box, setBox] = useState<ScoredBox | null>(null);
  const [stable, setStable] = useState(false);
  const pipeline = useLivePipeline(models, {
    onDetection(detection) {
      setBox(detection.box);
      setStable(detection.stable);
      onDetection?.(detection);
    },
    onView,
    onError,
  });
  const { setPaused, frameOutput } = pipeline;
  // A stable outputs array, so detections re-rendering this view never reconfigure the session.
  const outputs = useMemo(() => [frameOutput], [frameOutput]);
  useEffect(() => {
    // Keep the camera thread in step with sheets opening and closing.
    setPaused(!active);
  }, [active, setPaused]);
  return (
    <View style={styles.square}>
      <Camera
        style={StyleSheet.absoluteFill}
        device="back"
        isActive={visible}
        outputs={outputs}
        resizeMode="cover"
        onError={(error) => onError(error.message)}
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
  const photoOutput = usePhotoOutput({ qualityPrioritization: "speed" });
  const outputs = useMemo(() => [photoOutput], [photoOutput]);
  const [busy, setBusy] = useState(false);

  async function capture() {
    setBusy(true);
    try {
      const photo = await photoOutput.capturePhoto(
        { enableShutterSound: false },
        {},
      );
      const image = await uprightImage(
        await photo.toImageAsync(),
        photo.orientation,
      );
      onView(await embedImage(models, image, { detect: true }));
    } catch (cause) {
      onError(errorMessage(cause));
    } finally {
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
          onError={(error) => onError(error.message)}
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
