import { Ionicons } from "@expo/vector-icons";
import { Image } from "expo-image";
import { useState, type ComponentProps, type PropsWithChildren } from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  type StyleProp,
  type TextInputProps,
  type ViewStyle,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

// One quiet, light design system for the whole app: white surfaces, hairline
// borders, a single muted accent, and Inter. Screens read colours through
// usePalette() and text styles through `ui`, so the look is changed here only.

export type IconName = ComponentProps<typeof Ionicons>["name"];

const palette = {
  background: "#FFFFFF",
  surface: "#FFFFFF",
  /** Inputs, secondary buttons, chips, icon wells. */
  subtle: "#F5F6F8",
  text: "#0F1419",
  muted: "#6B7280",
  faint: "#9CA3AF",
  accent: "#1F5F4E",
  onAccent: "#FFFFFF",
  tint: "#EAF3EF",
  border: "#ECEEF1",
  danger: "#C0362C",
  dangerTint: "#FDF0EF",
} as const;

export type Palette = typeof palette;

/** The app is light only, whatever the phone's dark-mode setting. */
export function usePalette(): Palette {
  return palette;
}

/** Inter, loaded in the root layout. Android needs one family per weight. */
export const font = {
  regular: { fontFamily: "Inter_400Regular" },
  medium: { fontFamily: "Inter_500Medium" },
  semibold: { fontFamily: "Inter_600SemiBold" },
  bold: { fontFamily: "Inter_700Bold" },
} as const;

export function Screen({
  children,
  scroll = true,
}: PropsWithChildren<{ scroll?: boolean }>) {
  return (
    <SafeAreaView
      edges={["top", "left", "right"]}
      style={[ui.flex, { backgroundColor: palette.background }]}
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
  subtitle?: string;
  action?: React.ReactNode;
}) {
  return (
    <View style={ui.header}>
      <View style={ui.grow}>
        <Text
          accessibilityRole="header"
          style={[ui.title, { color: palette.text }]}
        >
          {title}
        </Text>
        {!!subtitle && (
          <Text style={[ui.body, { color: palette.muted }]}>{subtitle}</Text>
        )}
      </View>
      {action}
    </View>
  );
}

/** A screen title with a back button, for screens opened on top of the tabs. */
export function TopBar({
  title,
  subtitle,
  onBack,
  backLabel = "Back",
  backIcon = "arrow-back",
  action,
  disabled = false,
}: {
  title: string;
  subtitle?: string;
  onBack: () => void;
  backLabel?: string;
  backIcon?: IconName;
  action?: React.ReactNode;
  disabled?: boolean;
}) {
  return (
    <View style={[ui.header, { alignItems: "flex-start" }]}>
      <IconButton
        icon={backIcon}
        accessibilityLabel={backLabel}
        disabled={disabled}
        onPress={onBack}
      />
      <View style={[ui.grow, { paddingTop: 2 }]}>
        <Text
          accessibilityRole="header"
          style={[
            ui.title,
            { color: palette.text, fontSize: 22, lineHeight: 30 },
          ]}
        >
          {title}
        </Text>
        {!!subtitle && (
          <Text style={[ui.body, { color: palette.muted, fontSize: 14 }]}>
            {subtitle}
          </Text>
        )}
      </View>
      {action}
    </View>
  );
}

/** A small section title with an optional action on the right. */
export function SectionHeader({
  title,
  action,
}: {
  title: string;
  action?: React.ReactNode;
}) {
  return (
    <View style={ui.spread}>
      <Text
        accessibilityRole="header"
        style={[ui.sectionTitle, { color: palette.text }]}
      >
        {title}
      </Text>
      {action}
    </View>
  );
}

export function Label({
  children,
  muted = false,
}: PropsWithChildren<{ muted?: boolean }>) {
  return (
    <Text style={[ui.body, { color: muted ? palette.muted : palette.text }]}>
      {children}
    </Text>
  );
}

export function Card({
  children,
  style,
}: PropsWithChildren<{ style?: StyleProp<ViewStyle> }>) {
  return (
    <View
      style={[
        ui.card,
        { backgroundColor: palette.surface, borderColor: palette.border },
        style,
      ]}
    >
      {children}
    </View>
  );
}

export function Divider() {
  return <View style={[ui.divider, { backgroundColor: palette.border }]} />;
}

export type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";

const buttonColors: Record<ButtonVariant, { bg: string; fg: string }> = {
  primary: { bg: palette.accent, fg: palette.onAccent },
  secondary: { bg: palette.subtle, fg: palette.text },
  ghost: { bg: "transparent", fg: palette.accent },
  danger: { bg: palette.dangerTint, fg: palette.danger },
};

export function Button({
  title,
  onPress,
  secondary = false,
  variant = secondary ? "secondary" : "primary",
  size = "md",
  icon,
  disabled = false,
  busy = false,
  accessibilityLabel,
  testID,
}: {
  title: string;
  onPress: () => void;
  /** Shorthand for `variant="secondary"`. */
  secondary?: boolean;
  variant?: ButtonVariant;
  size?: "md" | "sm";
  icon?: IconName;
  disabled?: boolean;
  busy?: boolean;
  accessibilityLabel?: string;
  testID?: string;
}) {
  const { bg, fg } = buttonColors[variant];
  const small = size === "sm";
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
        small && ui.buttonSmall,
        {
          backgroundColor: bg,
          opacity: disabled ? 0.4 : pressed ? 0.7 : 1,
        },
      ]}
    >
      {busy ? (
        <ActivityIndicator size="small" color={fg} />
      ) : (
        icon && <Ionicons name={icon} size={small ? 16 : 18} color={fg} />
      )}
      <Text
        numberOfLines={1}
        style={[ui.buttonText, small && ui.buttonTextSmall, { color: fg }]}
      >
        {title}
      </Text>
    </Pressable>
  );
}

/** A round icon-only button; the label is read by screen readers. */
export function IconButton({
  icon,
  onPress,
  accessibilityLabel,
  variant = "subtle",
  size = 40,
  disabled = false,
}: {
  icon: IconName;
  onPress: () => void;
  accessibilityLabel: string;
  variant?: "subtle" | "plain" | "accent";
  size?: number;
  disabled?: boolean;
}) {
  const bg =
    variant === "accent"
      ? palette.accent
      : variant === "subtle"
        ? palette.subtle
        : "transparent";
  const fg = variant === "accent" ? palette.onAccent : palette.text;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityState={{ disabled }}
      disabled={disabled}
      hitSlop={6}
      onPress={onPress}
      style={({ pressed }) => ({
        width: size,
        height: size,
        borderRadius: size / 2,
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: bg,
        opacity: disabled ? 0.35 : pressed ? 0.6 : 1,
      })}
    >
      <Ionicons name={icon} size={Math.round(size * 0.5)} color={fg} />
    </Pressable>
  );
}

export function Chip({
  label,
  selected,
  onPress,
  accessibilityLabel,
}: {
  label: string;
  selected: boolean;
  onPress: () => void;
  accessibilityLabel?: string;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityState={{ selected }}
      onPress={onPress}
      style={({ pressed }) => [
        ui.chip,
        {
          backgroundColor: selected ? palette.tint : palette.subtle,
          opacity: pressed ? 0.7 : 1,
        },
      ]}
    >
      <Text
        style={[
          ui.chipText,
          selected ? font.semibold : font.medium,
          { color: selected ? palette.accent : palette.muted },
        ]}
      >
        {label}
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
  return (
    <View
      accessibilityLiveRegion="polite"
      style={[
        ui.notice,
        { backgroundColor: error ? palette.dangerTint : palette.subtle },
      ]}
    >
      <Ionicons
        name={error ? "alert-circle-outline" : "information-circle-outline"}
        size={18}
        color={error ? palette.danger : palette.muted}
      />
      <Text
        style={[
          ui.body,
          ui.grow,
          { color: error ? palette.danger : palette.text, fontSize: 14 },
        ]}
      >
        {message}
      </Text>
    </View>
  );
}

export function Empty({
  title,
  description,
  action,
  icon = "file-tray-outline",
}: {
  title: string;
  description: string;
  action?: React.ReactNode;
  icon?: IconName;
}) {
  return (
    <View style={ui.empty}>
      <View style={[ui.emptyIcon, { backgroundColor: palette.subtle }]}>
        <Ionicons name={icon} size={24} color={palette.muted} />
      </View>
      <Text
        style={[ui.sectionTitle, { color: palette.text, textAlign: "center" }]}
      >
        {title}
      </Text>
      <Text style={[ui.body, { color: palette.muted, textAlign: "center" }]}>
        {description}
      </Text>
      {action && <View style={{ alignSelf: "stretch" }}>{action}</View>}
    </View>
  );
}

/** A product photo, or the product's initial on a soft tile when it has none. */
export function Thumb({
  uri,
  name,
  size = 48,
}: {
  uri: string | null;
  name: string;
  size?: number;
}) {
  const frame = { width: size, height: size, borderRadius: size * 0.25 };
  if (uri)
    return (
      <Image
        source={{ uri }}
        accessibilityLabel={name}
        contentFit="cover"
        transition={150}
        style={[frame, { backgroundColor: palette.subtle }]}
      />
    );
  return (
    <View
      style={[
        frame,
        {
          backgroundColor: palette.tint,
          alignItems: "center",
          justifyContent: "center",
        },
      ]}
    >
      <Text
        style={[font.semibold, { color: palette.accent, fontSize: size * 0.4 }]}
      >
        {name.trim().slice(0, 1).toUpperCase()}
      </Text>
    </View>
  );
}

export function Field({
  label,
  hint,
  error,
  accessory,
  icon,
  ...props
}: TextInputProps & {
  label?: string;
  hint?: string;
  error?: string;
  /** Rendered beside the input, e.g. a Scan button. */
  accessory?: React.ReactNode;
  /** Shown inside the input on the left, e.g. a search glass. */
  icon?: IconName;
}) {
  const [focused, setFocused] = useState(false);
  const borderColor = error
    ? palette.danger
    : focused
      ? palette.accent
      : palette.subtle;
  const input = (
    <View
      style={[
        ui.inputFrame,
        accessory ? ui.grow : null,
        { backgroundColor: palette.subtle, borderColor },
      ]}
    >
      {icon && <Ionicons name={icon} size={18} color={palette.faint} />}
      <TextInput
        accessibilityLabel={label ?? props.placeholder}
        accessibilityHint={error}
        placeholderTextColor={palette.faint}
        selectionColor={palette.accent}
        {...props}
        onFocus={(event) => {
          setFocused(true);
          props.onFocus?.(event);
        }}
        onBlur={(event) => {
          setFocused(false);
          props.onBlur?.(event);
        }}
        style={[ui.input, { color: palette.text }, props.style]}
      />
    </View>
  );
  return (
    <View style={ui.field}>
      {!!label && (
        <Text style={[ui.fieldLabel, { color: palette.muted }]}>{label}</Text>
      )}
      {accessory ? (
        <View style={ui.row}>
          {input}
          {accessory}
        </View>
      ) : (
        input
      )}
      {error ? (
        <Text style={[ui.caption, { color: palette.danger }]}>{error}</Text>
      ) : (
        hint && (
          <Text style={[ui.caption, { color: palette.muted }]}>{hint}</Text>
        )
      )}
    </View>
  );
}

/**
 * A − quantity + control. Without `min`, stepping below one removes the item
 * (a cart line); with `min`, the value stops there instead.
 */
export function Stepper({
  value,
  name,
  onChange,
  min,
  max,
  disabled = false,
}: {
  value: number;
  /** For screen readers, e.g. "Sugar · 2 kg". */
  name: string;
  onChange: (value: number) => void;
  min?: number;
  max?: number;
  disabled?: boolean;
}) {
  const removes = min === undefined && value <= 1;
  return (
    <View style={[ui.stepper, { borderColor: palette.border }]}>
      <IconButton
        icon={removes ? "trash-outline" : "remove"}
        variant="plain"
        size={34}
        disabled={disabled || (min !== undefined && value <= min)}
        accessibilityLabel={
          removes ? `Remove ${name}` : `Decrease ${name} quantity`
        }
        onPress={() => onChange(value - 1)}
      />
      <Text
        accessibilityLabel={`${name} quantity ${value}`}
        style={[ui.stepperValue, { color: palette.text }]}
      >
        {value}
      </Text>
      <IconButton
        icon="add"
        variant="plain"
        size={34}
        disabled={disabled || (max !== undefined && value >= max)}
        accessibilityLabel={`Increase ${name} quantity`}
        onPress={() => onChange(value + 1)}
      />
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
    paddingHorizontal: 20,
    paddingTop: 12,
    paddingBottom: 32,
    gap: 16,
    width: "100%",
    maxWidth: 760,
    alignSelf: "center",
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingTop: 8,
    paddingBottom: 4,
  },
  eyebrow: {
    ...font.semibold,
    fontSize: 11,
    letterSpacing: 1.2,
    textTransform: "uppercase",
    marginBottom: 4,
  },
  title: {
    ...font.semibold,
    fontSize: 26,
    lineHeight: 32,
    letterSpacing: -0.5,
    marginBottom: 2,
  },
  sectionTitle: {
    ...font.semibold,
    fontSize: 16,
    lineHeight: 22,
    letterSpacing: -0.1,
  },
  body: { ...font.regular, fontSize: 15, lineHeight: 22 },
  caption: { ...font.regular, fontSize: 13, lineHeight: 18 },
  money: { ...font.semibold, fontVariant: ["tabular-nums"] },
  card: { borderWidth: 1, borderRadius: 16, padding: 16, gap: 12 },
  button: {
    minHeight: 48,
    borderRadius: 12,
    paddingHorizontal: 18,
    paddingVertical: 12,
    alignItems: "center",
    justifyContent: "center",
    flexDirection: "row",
    gap: 8,
  },
  buttonSmall: {
    minHeight: 36,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 6,
    gap: 6,
  },
  buttonText: { ...font.semibold, fontSize: 15, textAlign: "center" },
  buttonTextSmall: { fontSize: 14 },
  chip: {
    minHeight: 36,
    justifyContent: "center",
    paddingHorizontal: 14,
    borderRadius: 18,
  },
  chipText: { fontSize: 14 },
  notice: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 10,
    padding: 12,
    borderRadius: 12,
  },
  empty: {
    alignItems: "center",
    gap: 8,
    paddingVertical: 32,
    paddingHorizontal: 16,
  },
  emptyIcon: {
    width: 52,
    height: 52,
    borderRadius: 26,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 4,
  },
  field: { gap: 6 },
  fieldLabel: { ...font.medium, fontSize: 13 },
  inputFrame: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    borderWidth: 1,
    borderRadius: 12,
    minHeight: 48,
    paddingHorizontal: 14,
  },
  input: {
    ...font.regular,
    flex: 1,
    minWidth: 0,
    fontSize: 15,
    paddingVertical: 12,
  },
  stepper: {
    flexDirection: "row",
    alignItems: "center",
    borderWidth: 1,
    borderRadius: 20,
    paddingHorizontal: 2,
  },
  stepperValue: {
    ...font.semibold,
    fontSize: 15,
    minWidth: 28,
    textAlign: "center",
    fontVariant: ["tabular-nums"],
  },
  row: { flexDirection: "row", alignItems: "center", gap: 12 },
  spread: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
  },
  wrap: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  stack: { gap: 12 },
  divider: { height: StyleSheet.hairlineWidth * 2 },
  thumbnail: { width: 48, height: 48, borderRadius: 12 },
});
