import { Modal, StyleSheet, Text, View } from "react-native";
import { SafeAreaProvider, SafeAreaView } from "react-native-safe-area-context";

import { Button, ui, usePalette } from "@/components/shop-ui";
import { feedback } from "@/features/feedback";
import { ScannerCamera } from "@/features/scanner/scanner-camera";

/**
 * Captures a single barcode for a form. A modal (not a route) keeps the form
 * underneath mounted, so nothing typed so far is lost.
 */
export function BarcodeCaptureModal({
  visible,
  title,
  onCapture,
  onClose,
}: {
  visible: boolean;
  title: string;
  onCapture: (code: string) => void;
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
              Scan barcode
            </Text>
            <Text style={[ui.body, { color: c.muted }]}>{title}</Text>
          </View>
          <ScannerCamera
            active={visible}
            style={ui.flex}
            hint="Fit the barcode inside the frame"
            onRecognition={(recognition) => {
              if (recognition.kind !== "barcode") return;
              feedback.success();
              onCapture(recognition.code);
            }}
          />
          <Button title="Cancel" secondary onPress={onClose} />
        </SafeAreaView>
      </SafeAreaProvider>
    </Modal>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, padding: 20, gap: 18 },
});
