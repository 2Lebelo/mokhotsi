import {
  Inter_400Regular,
  Inter_500Medium,
  Inter_600SemiBold,
  Inter_700Bold,
  useFonts,
} from "@expo-google-fonts/inter";
import NetInfo from "@react-native-community/netinfo";
import { onlineManager, QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { DefaultTheme, Stack, ThemeProvider } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { useEffect } from "react";
import { SafeAreaProvider } from "react-native-safe-area-context";

import { DeviceProvider } from "@/auth/device-provider";
import { SessionProvider, useSession } from "@/auth/session-provider";
import { usePalette } from "@/components/shop-ui";
import { hideSplash } from "@/components/splash";
import { ToastProvider } from "@/components/toast";
import { sweepStagedPhotos } from "@/features/photos";
import { SyncProvider } from "@/features/sync/sync-provider";

export { ErrorBoundary } from "expo-router";

// Online-only screens (staff, shops, admin) pause their queries while the phone is offline.
onlineManager.setEventListener((setOnline) =>
  NetInfo.addEventListener((state) => setOnline(state.isConnected !== false)),
);

// The API client already retries what is safe to retry.
const queryClient = new QueryClient({
  defaultOptions: {
    queries: { retry: false, staleTime: 30_000 },
    mutations: { retry: false },
  },
});

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
  if (!loaded && !failed) return null;

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
          <QueryClientProvider client={queryClient}>
            <DeviceProvider>
              <SyncProvider>
                <SessionProvider>
                  <Gate />
                </SessionProvider>
              </SyncProvider>
            </DeviceProvider>
          </QueryClientProvider>
        </ToastProvider>
      </ThemeProvider>
    </SafeAreaProvider>
  );
}

/**
 * One guard per phase (auth/phase.ts): only the current phase's screens exist, so nothing
 * behind the PIN can be reached, deep-linked or gone back to. When the phase changes, the
 * router moves to the first screen that exists and drops the history of the ones that don't.
 */
function Gate() {
  const { phase } = useSession();
  useEffect(() => hideSplash(), []);
  // Photos from product forms that were never saved (the app closed or crashed).
  useEffect(() => sweepStagedPhotos(), []);
  return (
    <Stack screenOptions={{ headerShown: false, animation: "fade" }}>
      <Stack.Protected guard={phase === "open"}>
        <Stack.Screen name="(app)" />
      </Stack.Protected>
      <Stack.Protected guard={phase === "locked"}>
        <Stack.Screen name="unlock" />
      </Stack.Protected>
      <Stack.Protected guard={phase === "signed-out"}>
        <Stack.Screen name="sign-in" />
        <Stack.Screen name="sign-up" options={{ animation: "slide_from_right" }} />
      </Stack.Protected>
      <Stack.Protected guard={phase === "setup"}>
        <Stack.Screen name="setup" />
      </Stack.Protected>
      <Stack.Protected guard={phase === "admin"}>
        <Stack.Screen name="admin" />
      </Stack.Protected>
      <Stack.Protected guard={phase === "unconfigured"}>
        <Stack.Screen name="not-connected" />
      </Stack.Protected>
    </Stack>
  );
}
