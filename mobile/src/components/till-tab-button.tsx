import { Ionicons } from "@expo/vector-icons";
import type { BottomTabBarButtonProps } from "expo-router/js-tabs";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { font, usePalette } from "@/components/shop-ui";

/** The centre Till button in the tab bar: a raised, rounded square. */
export function TillTabButton({
  onPress,
  onLongPress,
  accessibilityState,
  testID,
}: BottomTabBarButtonProps) {
  const c = usePalette();
  const selected = !!accessibilityState?.selected;
  return (
    <View style={styles.slot}>
      <Pressable
        accessibilityRole="tab"
        accessibilityLabel="Till, scan products to sell"
        accessibilityState={{ selected }}
        testID={testID}
        onPress={onPress}
        onLongPress={onLongPress}
        style={({ pressed }) => [
          styles.button,
          {
            backgroundColor: c.accent,
            borderColor: c.surface,
            opacity: pressed ? 0.85 : 1,
          },
        ]}
      >
        <Ionicons name="scan-outline" size={24} color={c.onAccent} />
      </Pressable>
      <Text style={[styles.label, { color: selected ? c.accent : c.faint }]}>
        Till
      </Text>
    </View>
  );
}

const SIZE = 52;

const styles = StyleSheet.create({
  slot: { flex: 1, alignItems: "center", justifyContent: "flex-end" },
  button: {
    width: SIZE,
    height: SIZE,
    borderRadius: 16,
    borderWidth: 3,
    alignItems: "center",
    justifyContent: "center",
    marginTop: -SIZE / 2,
    elevation: 3,
    shadowColor: "#0F1419",
    shadowOpacity: 0.12,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
  },
  label: { ...font.medium, fontSize: 11, marginTop: 2, marginBottom: 4 },
});
