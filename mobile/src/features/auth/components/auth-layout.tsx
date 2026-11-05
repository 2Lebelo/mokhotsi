import { Ionicons } from "@expo/vector-icons";
import { useEffect, type PropsWithChildren, type ReactNode } from "react";
import {
  BackHandler,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { font, IconButton, Notice, ui, usePalette } from "@/components/shop-ui";
import { useOnline } from "@/hooks/use-online";

/**
 * The frame of every screen before the till: the brand, a title, one column of content and
 * a footer, centred and readable on any phone. It says so when the phone is offline.
 * `onBack` adds a back button (and handles Android's back) for screens reached from the PIN pad.
 */
export function AuthLayout({
  title,
  subtitle,
  footer,
  onBack,
  backLabel = "Back",
  children,
}: PropsWithChildren<{
  title: string;
  subtitle?: string;
  footer?: ReactNode;
  onBack?: () => void;
  backLabel?: string;
}>) {
  const c = usePalette();
  const online = useOnline();
  useEffect(() => {
    if (!onBack) return;
    const subscription = BackHandler.addEventListener("hardwareBackPress", () => {
      onBack();
      return true;
    });
    return () => subscription.remove();
  }, [onBack]);
  return (
    <SafeAreaView style={[ui.flex, { backgroundColor: c.background }]}>
      <KeyboardAvoidingView
        style={ui.flex}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <ScrollView
          contentContainerStyle={styles.scroll}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <View style={styles.column}>
            <View style={styles.brand}>
              {onBack && (
                <IconButton icon="arrow-back" accessibilityLabel={backLabel} onPress={onBack} />
              )}
              <View style={[styles.mark, { backgroundColor: c.accent }]}>
                <Ionicons name="storefront" size={22} color={c.onAccent} />
              </View>
              <Text style={[styles.wordmark, { color: c.text }]}>Mokhotsi</Text>
            </View>
            <View style={styles.heading}>
              <Text accessibilityRole="header" style={[ui.title, { color: c.text }]}>
                {title}
              </Text>
              {!!subtitle && (
                <Text style={[ui.body, { color: c.muted }]}>{subtitle}</Text>
              )}
            </View>
            {!online && (
              <Notice message="You're offline. Connect to the internet to continue." error />
            )}
            <View style={styles.content}>{children}</View>
          </View>
          {footer && <View style={styles.footer}>{footer}</View>}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

/** "New to Mokhotsi? Create an account". */
export function AuthLink({
  prompt,
  action,
  onPress,
}: {
  prompt: string;
  action: string;
  onPress: () => void;
}) {
  const c = usePalette();
  return (
    <View style={styles.link}>
      <Text style={[ui.body, { color: c.muted }]}>{prompt}</Text>
      <Pressable
        accessibilityRole="link"
        hitSlop={8}
        onPress={onPress}
        style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1 })}
      >
        <Text style={[ui.body, font.semibold, { color: c.accent }]}>{action}</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  scroll: {
    flexGrow: 1,
    justifyContent: "space-between",
    paddingHorizontal: 24,
    paddingTop: 32,
    paddingBottom: 24,
    gap: 24,
  },
  column: { width: "100%", maxWidth: 420, alignSelf: "center", gap: 24 },
  brand: { flexDirection: "row", alignItems: "center", gap: 10 },
  mark: {
    width: 40,
    height: 40,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  wordmark: { ...font.bold, fontSize: 18, letterSpacing: -0.2 },
  heading: { gap: 6, marginTop: 16 },
  content: { gap: 18 },
  footer: { width: "100%", maxWidth: 420, alignSelf: "center", gap: 12 },
  link: {
    flexDirection: "row",
    justifyContent: "center",
    flexWrap: "wrap",
    gap: 6,
  },
});
