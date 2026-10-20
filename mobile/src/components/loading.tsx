import { ActivityIndicator, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { ui, usePalette } from "@/components/shop-ui";

/** A full-screen wait: a spinner and one short line saying what is happening. */
export function LoadingScreen({ message }: { message: string }) {
  const c = usePalette();
  return (
    <SafeAreaView style={[styles.page, { backgroundColor: c.background }]}>
      <View
        accessible
        accessibilityRole="progressbar"
        accessibilityLabel={message}
        style={styles.center}
      >
        <ActivityIndicator size="large" color={c.accent} />
        <Text style={[ui.body, { color: c.muted, textAlign: "center" }]}>
          {message}
        </Text>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1 },
  center: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: 16,
    padding: 32,
  },
});
