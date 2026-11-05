import { Ionicons } from "@expo/vector-icons";
import { forwardRef, useEffect, useState } from "react";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withSequence,
  withTiming,
} from "react-native-reanimated";

import { font, ui, usePalette } from "@/components/shop-ui";
import { PIN_LENGTH } from "@/domain/pin";

/**
 * A 5-digit PIN as five boxes over one hidden number-pad input: digits show as dots unless
 * revealed, the next box is highlighted, and the row shakes when `shakeKey` changes (a wrong
 * PIN). `onComplete` fires on the fifth digit, so nobody has to find a button.
 */
export const PinCells = forwardRef<
  TextInput,
  {
    label: string;
    value: string;
    onChange: (value: string) => void;
    onComplete?: (pin: string) => void;
    error?: string;
    hint?: string;
    shakeKey?: number;
    autoFocus?: boolean;
    editable?: boolean;
  }
>(function PinCells(
  { label, value, onChange, onComplete, error, hint, shakeKey = 0, autoFocus, editable = true },
  ref,
) {
  const c = usePalette();
  const [focused, setFocused] = useState(false);
  const [revealed, setRevealed] = useState(false);
  const offset = useSharedValue(0);
  const shake = useAnimatedStyle(() => ({ transform: [{ translateX: offset.value }] }));

  useEffect(() => {
    if (shakeKey === 0) return;
    offset.set(
      withSequence(
        withTiming(-8, { duration: 45 }),
        withRepeat(withTiming(8, { duration: 90 }), 3, true),
        withTiming(0, { duration: 45 }),
      ),
    );
  }, [shakeKey, offset]);

  return (
    <View style={ui.field}>
      <View style={ui.spread}>
        <Text style={[ui.fieldLabel, { color: c.muted }]}>{label}</Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={revealed ? `Hide ${label}` : `Show ${label}`}
          hitSlop={10}
          onPress={() => setRevealed((value) => !value)}
        >
          <Ionicons name={revealed ? "eye-off-outline" : "eye-outline"} size={18} color={c.faint} />
        </Pressable>
      </View>
      <Animated.View style={[styles.row, shake]}>
        {Array.from({ length: PIN_LENGTH }, (_, i) => {
          const filled = i < value.length;
          const current = focused && i === Math.min(value.length, PIN_LENGTH - 1);
          return (
            <View
              key={i}
              style={[
                styles.cell,
                {
                  backgroundColor: c.subtle,
                  borderColor: error ? c.danger : current ? c.accent : c.subtle,
                },
              ]}
            >
              {filled &&
                (revealed ? (
                  <Text style={[styles.digit, { color: c.text }]}>{value[i]}</Text>
                ) : (
                  <View style={[styles.dot, { backgroundColor: c.text }]} />
                ))}
            </View>
          );
        })}
        <TextInput
          ref={ref}
          accessibilityLabel={label}
          accessibilityHint={error ?? hint}
          value={value}
          onChangeText={(text) => {
            const next = text.replace(/\D/g, "").slice(0, PIN_LENGTH);
            onChange(next);
            if (next.length === PIN_LENGTH && next !== value) onComplete?.(next);
          }}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          keyboardType="number-pad"
          textContentType="oneTimeCode"
          autoComplete="off"
          maxLength={PIN_LENGTH}
          autoFocus={autoFocus}
          editable={editable}
          caretHidden
          contextMenuHidden
          style={styles.hidden}
        />
      </Animated.View>
      {error ? (
        <Text style={[ui.caption, { color: c.danger }]}>{error}</Text>
      ) : (
        !!hint && <Text style={[ui.caption, { color: c.muted }]}>{hint}</Text>
      )}
    </View>
  );
});

const styles = StyleSheet.create({
  row: { flexDirection: "row", gap: 10 },
  cell: {
    flex: 1,
    height: 56,
    maxWidth: 64,
    borderRadius: 14,
    borderWidth: 1.5,
    alignItems: "center",
    justifyContent: "center",
  },
  dot: { width: 12, height: 12, borderRadius: 6 },
  digit: { ...font.semibold, fontSize: 22 },
  // Covers the boxes, so a tap anywhere on them focuses the input; invisible itself.
  hidden: {
    position: "absolute",
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    opacity: 0.02,
    color: "transparent",
  },
});
