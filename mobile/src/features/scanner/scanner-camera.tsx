import { MaterialCommunityIcons } from "@expo/vector-icons";
import {
  CameraView,
  useCameraPermissions,
  type BarcodeScanningResult,
  type BarcodeType,
} from "expo-camera";
import { useState } from "react";
import {
  ActivityIndicator,
  Linking,
  Pressable,
  StyleSheet,
  Text,
  View,
  type StyleProp,
  type ViewStyle,
} from "react-native";

import { Button, ui, usePalette } from "@/components/shop-ui";
import { normalizeBarcode, RETAIL_SYMBOLOGIES } from "@/domain/barcode";
import type { Recognition } from "@/features/recognition/types";
import { ScanGate } from "@/features/scanner/scan-gate";
import { useCameraVisibility } from "@/features/scanner/use-camera-visibility";

const BARCODE_TYPES: BarcodeType[] = [...RETAIL_SYMBOLOGIES];

type Props = {
  /** When false, codes are tracked but not reported (e.g. while a sheet is open). */
  active: boolean;
  onRecognition: (recognition: Recognition) => void;
  hint?: string;
  style?: StyleProp<ViewStyle>;
};

/**
 * The only component that owns a camera. Sources of recognitions (barcodes now,
 * on-device models later) live here, so screens consume `Recognition` events only.
 */
export function ScannerCamera({
  active,
  onRecognition,
  hint = "Point the camera at a barcode",
  style,
}: Props) {
  const [permission, requestPermission] = useCameraPermissions();
  const visible = useCameraVisibility();
  const [torch, setTorch] = useState(false);
  const [gate] = useState(() => new ScanGate());

  function handleBarcode(result: BarcodeScanningResult) {
    const code = normalizeBarcode(result.data);
    if (!code) return;
    // The gate sees every frame, even while paused, so a code still in view when
    // scanning resumes is not reported a second time.
    if (gate.accept(code) && active)
      onRecognition({ kind: "barcode", code, symbology: result.type });
  }

  return (
    <View style={[styles.frame, style]}>
      {!permission ? (
        <ActivityIndicator color="#fff" />
      ) : !permission.granted ? (
        <CameraPermission
          canAskAgain={permission.canAskAgain}
          onRequest={() => void requestPermission()}
        />
      ) : (
        <>
          {visible && (
            <CameraView
              style={StyleSheet.absoluteFill}
              facing="back"
              enableTorch={torch}
              barcodeScannerSettings={{ barcodeTypes: BARCODE_TYPES }}
              onBarcodeScanned={handleBarcode}
            />
          )}
          <View pointerEvents="none" style={styles.overlay}>
            <View style={[styles.reticle, { opacity: active ? 1 : 0.35 }]} />
            <Text style={styles.hint}>{active ? hint : "Scanning paused"}</Text>
          </View>
          <Pressable
            accessibilityRole="switch"
            accessibilityLabel="Torch"
            accessibilityState={{ checked: torch }}
            onPress={() => setTorch((on) => !on)}
            style={styles.torch}
          >
            <MaterialCommunityIcons
              name={torch ? "flashlight-off" : "flashlight"}
              size={22}
              color="#fff"
            />
          </Pressable>
        </>
      )}
    </View>
  );
}

function CameraPermission({
  canAskAgain,
  onRequest,
}: {
  canAskAgain: boolean;
  onRequest: () => void;
}) {
  const c = usePalette();
  return (
    <View style={[styles.permission, { backgroundColor: c.surface }]}>
      <MaterialCommunityIcons
        name="camera-outline"
        size={32}
        color={c.accent}
      />
      <Text style={[ui.body, { color: c.text, textAlign: "center" }]}>
        {canAskAgain
          ? "Allow camera access to scan product barcodes."
          : "Camera access is off for Mokhotsi. Turn it on in your phone settings to scan barcodes."}
      </Text>
      <Button
        title={canAskAgain ? "Allow camera" : "Open settings"}
        onPress={canAskAgain ? onRequest : () => void Linking.openSettings()}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  frame: {
    overflow: "hidden",
    borderRadius: 24,
    backgroundColor: "#000",
    alignItems: "center",
    justifyContent: "center",
    minHeight: 220,
  },
  overlay: {
    position: "absolute",
    inset: 0,
    alignItems: "center",
    justifyContent: "center",
    gap: 14,
  },
  reticle: {
    width: "72%",
    aspectRatio: 2.2,
    borderWidth: 3,
    borderRadius: 16,
    borderColor: "#fff",
  },
  hint: {
    color: "#fff",
    fontSize: 14,
    fontWeight: "600",
    backgroundColor: "rgba(0,0,0,0.45)",
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 12,
    overflow: "hidden",
  },
  torch: {
    position: "absolute",
    top: 12,
    right: 12,
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(0,0,0,0.45)",
  },
  permission: {
    position: "absolute",
    inset: 0,
    alignItems: "center",
    justifyContent: "center",
    padding: 24,
    gap: 14,
  },
});
