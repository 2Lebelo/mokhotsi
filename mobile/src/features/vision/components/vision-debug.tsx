import { useEffect, useMemo, useRef, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { Images, NitroImage } from "react-native-nitro-image";

import type { Candidate } from "@/ml/vector-index";
import type { CameraMode } from "@/features/vision/vision-camera-view";
import type { EmbeddedView } from "@/features/vision/types";
import type { LiveDetection } from "@/features/vision/use-live-pipeline";

/**
 * Development-only readout for tuning on a device: detector rate and latency,
 * accelerator, best score, and the exact crop the embedder saw. An upright,
 * correctly coloured, tight crop is the quickest check that preprocessing is right.
 */
export function VisionDebug(props: {
  mode: CameraMode;
  accelerator: string;
  detection: LiveDetection | null;
  view: EmbeddedView | null;
  ranking: readonly Candidate[];
}) {
  if (!__DEV__) return null;
  return <DebugPanel {...props} />;
}

function DebugPanel({
  mode,
  accelerator,
  detection,
  view,
  ranking,
}: Parameters<typeof VisionDebug>[0]) {
  const times = useRef<number[]>([]);
  const [fps, setFps] = useState(0);
  useEffect(() => {
    if (!detection) return;
    const now = Date.now();
    times.current = [...times.current, now].filter((t) => now - t < 2000);
    setFps(times.current.length / 2);
  }, [detection]);

  const crop = useMemo(
    () =>
      view
        ? Images.loadFromRawPixelData({
            buffer: view.crop.rgbx.buffer as ArrayBuffer,
            width: view.crop.size,
            height: view.crop.size,
            pixelFormat: "RGBX",
          })
        : null,
    [view],
  );

  const best = ranking[0];
  return (
    <View style={styles.panel}>
      {crop && <NitroImage image={crop} style={styles.crop} />}
      <Text style={styles.text}>
        {mode} · {accelerator} · {fps.toFixed(1)} fps ·{" "}
        {detection?.latencyMs ?? "–"} ms
        {"\n"}box {detection?.box ? detection.box.score.toFixed(2) : "none"}
        {!detection?.box && detection?.score != null
          ? ` (best ${detection.score.toFixed(2)})`
          : ""}
        {detection?.stable ? " · stable" : ""} · best{" "}
        {best ? best.score.toFixed(3) : "–"}
        {ranking[1] ? ` (next ${ranking[1].score.toFixed(3)})` : ""}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  panel: {
    flexDirection: "row",
    gap: 8,
    alignItems: "center",
    backgroundColor: "rgba(0,0,0,0.75)",
    borderRadius: 10,
    padding: 8,
  },
  crop: { width: 56, height: 56, borderRadius: 6 },
  text: { color: "#fff", fontSize: 12, flex: 1, fontVariant: ["tabular-nums"] },
});
