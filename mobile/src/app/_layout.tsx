import {
  Inter_400Regular,
  Inter_500Medium,
  Inter_600SemiBold,
  Inter_700Bold,
  useFonts,
} from "@expo-google-fonts/inter";
import { DefaultTheme, Stack, ThemeProvider } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import { StatusBar } from "expo-status-bar";
import { useEffect } from "react";
import { SafeAreaProvider } from "react-native-safe-area-context";

import { usePalette } from "@/components/shop-ui";
import { ToastProvider } from "@/components/toast";
import { ShopProvider } from "@/db/ShopProvider";
import { VisionProvider } from "@/features/vision/vision-provider";

export { ErrorBoundary } from "expo-router";

void SplashScreen.preventAutoHideAsync().catch(() => {});

export default function RootLayout() {
  const c = usePalette();
  // Fonts are bundled, so this resolves almost at once; a failure falls back to
  // the system font rather than blocking the till.
  const [loaded, failed] = useFonts({
    Inter_400Regular,
    Inter_500Medium,
    Inter_600SemiBold,
    Inter_700Bold,
  });
  const ready = loaded || !!failed;
  useEffect(() => {
    if (ready) void SplashScreen.hideAsync().catch(() => {});
  }, [ready]);
  if (!ready) return null;

  // The app is light only (see usePalette), whatever the phone's setting.
  const theme = {
    ...DefaultTheme,
    colors: {
      ...DefaultTheme.colors,
      background: c.background,
      card: c.surface,
      border: c.border,
      primary: c.accent,
      text: c.text,
    },
  };
  return (
    <SafeAreaProvider>
      <ThemeProvider value={theme}>
        <StatusBar style="dark" />
        <ToastProvider>
          <ShopProvider>
            <VisionProvider>
              <Stack screenOptions={{ headerShown: false }}>
                <Stack.Screen name="(tabs)" />
                <Stack.Screen name="register" />
                <Stack.Screen name="identify" />
                <Stack.Screen name="sales" />
                <Stack.Screen name="reports" />
                <Stack.Screen name="users" />
              </Stack>
            </VisionProvider>
          </ShopProvider>
        </ToastProvider>
      </ThemeProvider>
    </SafeAreaProvider>
  );
}
