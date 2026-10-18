import type { PropsWithChildren } from "react";
import {
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { Button, ui, usePalette } from "@/components/shop-ui";

/** A bottom sheet for short decisions that must pause what is behind it. */
export function Sheet({
  visible,
  title,
  subtitle,
  onClose,
  children,
}: PropsWithChildren<{
  visible: boolean;
  title: string;
  subtitle?: string;
  onClose: () => void;
}>) {
  const c = usePalette();
  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      statusBarTranslucent
      onRequestClose={onClose}
    >
      <KeyboardAvoidingView
        style={styles.container}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <Pressable
          style={StyleSheet.absoluteFill}
          accessibilityRole="button"
          accessibilityLabel="Close"
          onPress={onClose}
        />
        <SafeAreaView
          edges={["bottom"]}
          style={[styles.panel, { backgroundColor: c.background }]}
        >
          <View style={[styles.handle, { backgroundColor: c.border }]} />
          <View style={ui.spread}>
            <View style={ui.grow}>
              <Text
                accessibilityRole="header"
                style={[ui.sectionTitle, { color: c.text }]}
              >
                {title}
              </Text>
              {subtitle && (
                <Text style={[ui.body, { color: c.muted }]}>{subtitle}</Text>
              )}
            </View>
            <Button title="Close" secondary onPress={onClose} />
          </View>
          {children}
        </SafeAreaView>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: "flex-end",
    backgroundColor: "rgba(0,0,0,0.45)",
  },
  panel: {
    maxHeight: "85%",
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    padding: 20,
    gap: 14,
  },
  handle: {
    alignSelf: "center",
    width: 40,
    height: 4,
    borderRadius: 2,
    marginTop: -8,
  },
});
