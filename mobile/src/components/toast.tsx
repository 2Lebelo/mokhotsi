import { Ionicons } from "@expo/vector-icons";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PropsWithChildren,
} from "react";
import {
  AccessibilityInfo,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import Animated, { FadeInUp, FadeOutUp } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { font, usePalette, type IconName } from "@/components/shop-ui";
import { feedback } from "@/features/feedback";

type Tone = "success" | "error" | "info";
type Toast = { id: number; tone: Tone; message: string };
type ToastApi = Record<Tone, (message: string) => void>;

const Context = createContext<ToastApi | null>(null);

const DURATION_MS: Record<Tone, number> = {
  success: 2400,
  info: 2800,
  error: 4000,
};

const ICONS: Record<Tone, IconName> = {
  success: "checkmark-circle",
  info: "information-circle",
  error: "alert-circle",
};

/**
 * Brief confirmations ("Product saved", "Sale complete") shown above every
 * screen. Mounted once at the root, so a toast survives navigating back.
 */
export function ToastProvider({ children }: PropsWithChildren) {
  const [toast, setToast] = useState<Toast | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const nextId = useRef(0);

  const show = useCallback((tone: Tone, message: string) => {
    clearTimeout(timer.current);
    nextId.current += 1;
    setToast({ id: nextId.current, tone, message });
    if (tone === "success") feedback.success();
    else if (tone === "error") feedback.error();
    AccessibilityInfo.announceForAccessibility(message);
    timer.current = setTimeout(() => setToast(null), DURATION_MS[tone]);
  }, []);

  useEffect(() => () => clearTimeout(timer.current), []);

  const api = useMemo<ToastApi>(
    () => ({
      success: (message) => show("success", message),
      error: (message) => show("error", message),
      info: (message) => show("info", message),
    }),
    [show],
  );

  return (
    <Context.Provider value={api}>
      <View style={styles.root}>
        {children}
        <ToastHost toast={toast} onDismiss={() => setToast(null)} />
      </View>
    </Context.Provider>
  );
}

function ToastHost({
  toast,
  onDismiss,
}: {
  toast: Toast | null;
  onDismiss: () => void;
}) {
  const c = usePalette();
  const insets = useSafeAreaInsets();
  const color =
    toast?.tone === "error"
      ? c.danger
      : toast?.tone === "success"
        ? c.accent
        : c.muted;
  return (
    <View
      pointerEvents="box-none"
      style={[styles.host, { top: insets.top + 8 }]}
    >
      {toast && (
        <Animated.View
          key={toast.id}
          entering={FadeInUp.duration(220)}
          exiting={FadeOutUp.duration(160)}
        >
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`${toast.message}. Dismiss`}
            onPress={onDismiss}
            style={[
              styles.toast,
              { backgroundColor: c.surface, borderColor: c.border },
            ]}
          >
            <Ionicons name={ICONS[toast.tone]} size={20} color={color} />
            <Text style={[styles.message, { color: c.text }]}>
              {toast.message}
            </Text>
          </Pressable>
        </Animated.View>
      )}
    </View>
  );
}

export function useToast(): ToastApi {
  const value = useContext(Context);
  if (!value) throw new Error("ToastProvider is required.");
  return value;
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  host: {
    position: "absolute",
    left: 16,
    right: 16,
    alignItems: "center",
  },
  toast: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    maxWidth: 520,
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: 14,
    borderWidth: 1,
    elevation: 6,
    shadowColor: "#0F1419",
    shadowOpacity: 0.08,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 6 },
  },
  message: { ...font.medium, fontSize: 14, lineHeight: 20, flexShrink: 1 },
});
