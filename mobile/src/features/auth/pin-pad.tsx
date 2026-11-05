import { Ionicons } from "@expo/vector-icons";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { font, usePalette } from "@/components/shop-ui";
import { PIN_LENGTH } from "@/domain/pin";

const ROWS = [
  ["1", "2", "3"],
  ["4", "5", "6"],
  ["7", "8", "9"],
  ["", "0", "back"],
] as const;

/** Five dots that fill as digits are typed. The digits themselves are never shown. */
export function PinDots({ length, error = false }: { length: number; error?: boolean }) {
  const c = usePalette();
  return (
    <View
      accessible
      accessibilityLabel={`${length} of ${PIN_LENGTH} digits entered`}
      style={styles.dots}
    >
      {Array.from({ length: PIN_LENGTH }, (_, i) => (
        <View
          key={i}
          style={[
            styles.dot,
            {
              borderColor: error ? c.danger : c.accent,
              backgroundColor: i < length ? (error ? c.danger : c.accent) : "transparent",
            },
          ]}
        />
      ))}
    </View>
  );
}

/**
 * A phone-style digit pad for PINs. It calls `onChange` with the new value and `onComplete`
 * once PIN_LENGTH digits are in, so nobody waits on the phone keyboard.
 */
export function PinPad({
  value,
  onChange,
  onComplete,
  disabled = false,
}: {
  value: string;
  onChange: (value: string) => void;
  onComplete?: (pin: string) => void;
  disabled?: boolean;
}) {
  const c = usePalette();
  const press = (key: string) => {
    if (key === "back") return onChange(value.slice(0, -1));
    if (value.length >= PIN_LENGTH) return;
    const next = value + key;
    onChange(next);
    if (next.length === PIN_LENGTH) onComplete?.(next);
  };
  return (
    <View style={styles.grid}>
      {ROWS.map((row, i) => (
        <View key={i} style={styles.row}>
          {row.map((key) =>
            key === "" ? (
              // Keys are compared as strings, so an index key here would clash with the "0" digit.
              <View key="spacer" style={styles.key} />
            ) : (
              <Pressable
                key={key}
                accessibilityRole="button"
                accessibilityLabel={key === "back" ? "Delete" : key}
                accessibilityHint={key === "back" ? "Hold to clear" : undefined}
                disabled={disabled}
                onPress={() => press(key)}
                onLongPress={key === "back" ? () => onChange("") : undefined}
                style={({ pressed }) => [
                  styles.key,
                  {
                    backgroundColor: pressed ? c.border : c.subtle,
                    opacity: disabled ? 0.5 : 1,
                  },
                ]}
              >
                {key === "back" ? (
                  <Ionicons name="backspace-outline" size={22} color={c.text} />
                ) : (
                  <Text style={[styles.label, { color: c.text }]}>{key}</Text>
                )}
              </Pressable>
            ),
          )}
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  dots: { flexDirection: "row", justifyContent: "center", gap: 16, paddingVertical: 8 },
  dot: { width: 16, height: 16, borderRadius: 8, borderWidth: 2 },
  grid: { gap: 10, width: "100%", maxWidth: 360, alignSelf: "center" },
  row: { flexDirection: "row", gap: 10 },
  key: {
    flex: 1,
    height: 60,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
  },
  label: { ...font.medium, fontSize: 24 },
});
