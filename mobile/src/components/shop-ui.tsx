import type { PropsWithChildren } from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  useColorScheme,
  View,
  type TextInputProps,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

const light = {
  background: "#F5F6F0",
  surface: "#FFFFFF",
  text: "#182D27",
  muted: "#63736A",
  accent: "#21654A",
  tint: "#E5F0E6",
  border: "#DFE5DC",
  danger: "#AD3027",
  dangerTint: "#FCEAE6",
};
const dark = {
  background: "#111C17",
  surface: "#1D2B23",
  text: "#F0F5EB",
  muted: "#AFBEB2",
  accent: "#9BD6AF",
  tint: "#2A4433",
  border: "#35483B",
  danger: "#FFB4A9",
  dangerTint: "#452A26",
};
export function usePalette() {
  return useColorScheme() === "dark" ? dark : light;
}

export function Screen({
  children,
  scroll = true,
}: PropsWithChildren<{ scroll?: boolean }>) {
  const colors = usePalette();
  return (
    <SafeAreaView
      edges={["top", "left", "right"]}
      style={[ui.flex, { backgroundColor: colors.background }]}
    >
      {scroll ? (
        <ScrollView
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={ui.page}
        >
          {children}
        </ScrollView>
      ) : (
        <View style={[ui.page, ui.flex]}>{children}</View>
      )}
    </SafeAreaView>
  );
}

export function Heading({
  title,
  subtitle,
  action,
}: {
  title: string;
  subtitle: string;
  action?: React.ReactNode;
}) {
  const c = usePalette();
  return (
    <View style={ui.header}>
      <View style={ui.grow}>
        <Text style={[ui.eyebrow, { color: c.accent }]}>
          MOKHOTSI · OFFLINE POS
        </Text>
        <Text accessibilityRole="header" style={[ui.title, { color: c.text }]}>
          {title}
        </Text>
        <Text style={[ui.body, { color: c.muted }]}>{subtitle}</Text>
      </View>
      {action}
    </View>
  );
}

export function Label({
  children,
  muted = false,
}: PropsWithChildren<{ muted?: boolean }>) {
  const c = usePalette();
  return (
    <Text style={[ui.body, { color: muted ? c.muted : c.text }]}>
      {children}
    </Text>
  );
}

export function Card({ children }: PropsWithChildren) {
  const c = usePalette();
  return (
    <View
      style={[ui.card, { backgroundColor: c.surface, borderColor: c.border }]}
    >
      {children}
    </View>
  );
}

export function Button({
  title,
  onPress,
  secondary = false,
  disabled = false,
  busy = false,
  accessibilityLabel,
  testID,
}: {
  title: string;
  onPress: () => void;
  secondary?: boolean;
  disabled?: boolean;
  busy?: boolean;
  accessibilityLabel?: string;
  testID?: string;
}) {
  const c = usePalette();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? title}
      accessibilityState={{ disabled: disabled || busy, busy }}
      testID={testID}
      disabled={disabled || busy}
      onPress={onPress}
      style={({ pressed }) => [
        ui.button,
        {
          backgroundColor: secondary ? c.tint : c.accent,
          opacity: disabled || busy ? 0.45 : pressed ? 0.75 : 1,
        },
      ]}
    >
      {busy && (
        <ActivityIndicator color={secondary ? c.accent : c.background} />
      )}
      <Text
        style={[ui.buttonText, { color: secondary ? c.accent : c.background }]}
      >
        {title}
      </Text>
    </Pressable>
  );
}

export function Notice({
  message,
  error = false,
}: {
  message: string;
  error?: boolean;
}) {
  const c = usePalette();
  return (
    <View
      accessibilityLiveRegion="polite"
      style={[ui.notice, { backgroundColor: error ? c.dangerTint : c.tint }]}
    >
      <Text style={[ui.body, { color: error ? c.danger : c.accent }]}>
        {message}
      </Text>
    </View>
  );
}

export function Empty({
  title,
  description,
  action,
}: {
  title: string;
  description: string;
  action?: React.ReactNode;
}) {
  const c = usePalette();
  return (
    <Card>
      <Text style={[ui.sectionTitle, { color: c.text }]}>{title}</Text>
      <Label muted>{description}</Label>
      {action}
    </Card>
  );
}

export function Field({
  label,
  hint,
  ...props
}: TextInputProps & { label: string; hint?: string }) {
  const c = usePalette();
  return (
    <View style={ui.field}>
      <Text style={[ui.fieldLabel, { color: c.text }]}>{label}</Text>
      <TextInput
        accessibilityLabel={label}
        placeholderTextColor={c.muted}
        {...props}
        style={[
          ui.input,
          { color: c.text, backgroundColor: c.surface, borderColor: c.border },
          props.style,
        ]}
      />
      {hint && <Text style={[ui.caption, { color: c.muted }]}>{hint}</Text>}
    </View>
  );
}

export function errorMessage(error: unknown) {
  return error instanceof Error
    ? error.message
    : "Something went wrong. Please try again.";
}

export const ui = StyleSheet.create({
  flex: { flex: 1 },
  grow: { flex: 1, minWidth: 0 },
  page: {
    padding: 20,
    paddingBottom: 32,
    gap: 18,
    width: "100%",
    maxWidth: 760,
    alignSelf: "center",
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingTop: 8,
    paddingBottom: 6,
  },
  eyebrow: {
    fontSize: 11,
    fontWeight: "800",
    letterSpacing: 1.6,
    marginBottom: 10,
  },
  title: {
    fontSize: 32,
    fontWeight: "800",
    letterSpacing: -1,
    marginBottom: 6,
  },
  sectionTitle: { fontSize: 20, fontWeight: "700" },
  body: { fontSize: 15, lineHeight: 22 },
  caption: { fontSize: 12, lineHeight: 18 },
  card: { borderWidth: 1, borderRadius: 20, padding: 18, gap: 12 },
  button: {
    minHeight: 48,
    borderRadius: 14,
    paddingHorizontal: 18,
    paddingVertical: 12,
    alignItems: "center",
    justifyContent: "center",
    flexDirection: "row",
    gap: 8,
  },
  buttonText: { fontSize: 15, fontWeight: "700", textAlign: "center" },
  notice: { padding: 14, borderRadius: 12 },
  field: { gap: 7 },
  fieldLabel: { fontSize: 14, fontWeight: "600" },
  input: {
    borderWidth: 1,
    borderRadius: 12,
    minHeight: 52,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 16,
  },
  row: { flexDirection: "row", alignItems: "center", gap: 12 },
  spread: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
  },
  wrap: { flexDirection: "row", flexWrap: "wrap", gap: 10 },
  stack: { gap: 12 },
  divider: { height: 1 },
  thumbnail: { width: 64, height: 64, borderRadius: 14 },
});
