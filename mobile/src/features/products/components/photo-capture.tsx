import { Image } from "expo-image";
import { useEffect, useMemo, useRef, useState } from "react";
import { Modal, StyleSheet, Text, View } from "react-native";
import { SafeAreaProvider, SafeAreaView } from "react-native-safe-area-context";
import {
  Camera,
  CommonResolutions,
  useCameraPermission,
  usePhotoOutput,
} from "react-native-vision-camera";

import { Button, ui, usePalette } from "@/components/shop-ui";
import { feedback } from "@/features/feedback";
import {
  discardStagedPhoto,
  photoProblem,
  squarePhoto,
} from "@/features/photos";
import { useCameraVisibility } from "@/features/scanner/use-camera-visibility";
import { disposeImages, uprightImage } from "@/features/vision/still-pipeline";
import {
  CameraGuide,
  CameraPermission,
} from "@/features/vision/vision-camera-view";

/**
 * Takes a product photo inside the app. The phone's own camera app would send Mokhotsi to
 * the background, where Android may kill it to free memory (the app then restarts and the
 * photo and the form are lost). A modal (not a route) keeps the form underneath mounted.
 */
export function PhotoCapture({
  visible,
  title,
  onCapture,
  onClose,
}: {
  visible: boolean;
  title: string;
  /** A staged square JPEG; the form copies it into product storage when saved. */
  onCapture: (uri: string) => void;
  onClose: () => void;
}) {
  const c = usePalette();
  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="fullScreen"
      onRequestClose={onClose}
    >
      <SafeAreaProvider>
        <SafeAreaView style={[styles.page, { backgroundColor: c.background }]}>
          <View style={ui.stack}>
            <Text
              accessibilityRole="header"
              style={[ui.title, { color: c.text }]}
            >
              {title}
            </Text>
            <Text style={[ui.body, { color: c.muted }]}>
              Fill the frame with the product, on a plain background.
            </Text>
          </View>
          {/* Mounted only while shown, so the camera is released when the modal closes. */}
          {visible && <Capture onCapture={onCapture} onClose={onClose} />}
        </SafeAreaView>
      </SafeAreaProvider>
    </Modal>
  );
}

function Capture({
  onCapture,
  onClose,
}: {
  onCapture: (uri: string) => void;
  onClose: () => void;
}) {
  const c = usePalette();
  const { hasPermission } = useCameraPermission();
  const visible = useCameraVisibility();
  // 1440 × 1920: the centre square is cut down to the stored 1080 px.
  const photoOutput = usePhotoOutput({
    targetResolution: CommonResolutions.FHD_4_3,
    qualityPrioritization: "balanced",
  });
  const outputs = useMemo(() => [photoOutput], [photoOutput]);
  const [shot, setShot] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  // A shot taken but not handed to the form is deleted when this closes, however it
  // closes (Cancel, the back button, or a capture that finishes after closing).
  const unused = useRef<string | null>(null);
  const closed = useRef(false);
  useEffect(() => {
    closed.current = false;
    return () => {
      closed.current = true;
      discardStagedPhoto(unused.current);
      unused.current = null;
    };
  }, []);

  async function take() {
    setBusy(true);
    setError("");
    const owned: { dispose(): void }[] = [];
    try {
      const photo = await photoOutput.capturePhoto(
        { enableShutterSound: false },
        {},
      );
      owned.push(photo);
      const decoded = await photo.toImageAsync();
      owned.push(decoded);
      const image = await uprightImage(decoded, photo.orientation);
      owned.push(image);
      const uri = await squarePhoto(image);
      if (closed.current) {
        discardStagedPhoto(uri);
        return;
      }
      unused.current = uri;
      setShot(uri);
      feedback.success();
    } catch (cause) {
      feedback.error();
      setError(photoProblem(cause, "The photo could not be taken. Please try again."));
    } finally {
      disposeImages(...owned);
      setBusy(false);
    }
  }

  function retake() {
    discardStagedPhoto(shot);
    unused.current = null;
    setShot(null);
  }

  function use(uri: string) {
    unused.current = null;
    onCapture(uri);
  }

  return (
    <>
      {!hasPermission ? (
        <CameraPermission purpose="to photograph products" />
      ) : (
        <View style={styles.square}>
          {shot ? (
            <Image
              source={{ uri: shot }}
              accessibilityLabel="The photo just taken"
              contentFit="cover"
              style={StyleSheet.absoluteFill}
            />
          ) : (
            <>
              <Camera
                style={StyleSheet.absoluteFill}
                device="back"
                isActive={visible}
                outputs={outputs}
                resizeMode="cover"
                onError={(cause) =>
                  setError(
                    photoProblem(
                      cause,
                      "The camera is not available. Close this screen and try again.",
                    ),
                  )
                }
              />
              <CameraGuide />
            </>
          )}
        </View>
      )}
      {!!error && (
        <Text style={[ui.body, { color: c.danger }]} accessibilityLiveRegion="polite">
          {error}
        </Text>
      )}
      <View style={ui.grow} />
      {shot ? (
        <View style={ui.row}>
          <View style={ui.grow}>
            <Button title="Retake" icon="refresh" secondary onPress={retake} />
          </View>
          <View style={ui.grow}>
            <Button title="Use photo" icon="checkmark" onPress={() => use(shot)} />
          </View>
        </View>
      ) : (
        <Button
          title="Take photo"
          icon="camera-outline"
          busy={busy}
          disabled={!hasPermission}
          onPress={() => void take()}
        />
      )}
      <Button title="Cancel" secondary disabled={busy} onPress={onClose} />
    </>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, padding: 20, gap: 18 },
  square: {
    width: "100%",
    aspectRatio: 1,
    borderRadius: 24,
    overflow: "hidden",
    backgroundColor: "#000",
  },
});
