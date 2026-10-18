import { MaterialCommunityIcons } from "@expo/vector-icons";
import type { BottomTabBarButtonProps } from "expo-router/js-tabs";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { usePalette } from "@/components/shop-ui";

/** The raised, centre Till button in the tab bar. */
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
        <MaterialCommunityIcons
          name="barcode-scan"
          size={28}
          color={c.background}
        />
      </Pressable>
      <Text style={[styles.label, { color: selected ? c.accent : c.muted }]}>
        Till
      </Text>
    </View>
  );
}

const SIZE = 62;

const styles = StyleSheet.create({
  slot: { flex: 1, alignItems: "center", justifyContent: "flex-end" },
  button: {
    width: SIZE,
    height: SIZE,
    borderRadius: SIZE / 2,
    borderWidth: 4,
    alignItems: "center",
    justifyContent: "center",
    marginTop: -SIZE / 2,
    elevation: 6,
    shadowColor: "#000",
    shadowOpacity: 0.2,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 3 },
  },
  label: { fontWeight: "600", fontSize: 11, marginTop: 2, marginBottom: 4 },
});
