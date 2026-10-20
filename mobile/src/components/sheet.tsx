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

import { IconButton, ui, usePalette } from "@/components/shop-ui";

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
          <View style={[ui.spread, { alignItems: "flex-start" }]}>
            <View style={ui.grow}>
              <Text
                accessibilityRole="header"
                style={[ui.sectionTitle, { color: c.text, fontSize: 18 }]}
              >
                {title}
              </Text>
              {subtitle && (
                <Text style={[ui.body, { color: c.muted, fontSize: 14 }]}>
                  {subtitle}
                </Text>
              )}
            </View>
            <IconButton
              icon="close"
              size={34}
              accessibilityLabel="Close"
              onPress={onClose}
            />
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
    backgroundColor: "rgba(15,20,25,0.35)",
  },
  panel: {
    maxHeight: "88%",
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingHorizontal: 20,
    paddingTop: 20,
    paddingBottom: 16,
    gap: 14,
  },
  handle: {
    alignSelf: "center",
    width: 36,
    height: 4,
    borderRadius: 2,
    marginTop: -8,
  },
});
