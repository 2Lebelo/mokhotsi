import { Ionicons } from "@expo/vector-icons";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { font, usePalette } from "@/components/shop-ui";
import type { KeypadKey } from "@/domain/cash";

const ROWS: KeypadKey[][] = [
  ["1", "2", "3"],
  ["4", "5", "6"],
  ["7", "8", "9"],
  [".", "0", "back"],
];

/** A calculator-style number pad, so the cash amount never waits on the phone keyboard. */
export function Keypad({
  onKey,
  onClear,
  disabled = false,
}: {
  onKey: (key: KeypadKey) => void;
  /** Long-press on delete clears the whole amount. */
  onClear: () => void;
  disabled?: boolean;
}) {
  const c = usePalette();
  return (
    <View style={styles.grid}>
      {ROWS.map((row, i) => (
        <View key={i} style={styles.row}>
          {row.map((key) => (
            <Pressable
              key={key}
              accessibilityRole="button"
              accessibilityLabel={
                key === "back" ? "Delete" : key === "." ? "Decimal point" : key
              }
              accessibilityHint={key === "back" ? "Hold to clear" : undefined}
              disabled={disabled}
              onPress={() => onKey(key)}
              onLongPress={key === "back" ? onClear : undefined}
              style={({ pressed }) => [
                styles.key,
                { backgroundColor: pressed ? c.border : c.subtle },
              ]}
            >
              {key === "back" ? (
                <Ionicons name="backspace-outline" size={22} color={c.text} />
              ) : (
                <Text style={[styles.label, { color: c.text }]}>{key}</Text>
              )}
            </Pressable>
          ))}
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  grid: { gap: 8 },
  row: { flexDirection: "row", gap: 8 },
  key: {
    flex: 1,
    height: 52,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  label: { ...font.medium, fontSize: 22 },
});
