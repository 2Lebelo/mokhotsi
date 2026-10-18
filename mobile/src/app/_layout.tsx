import { DarkTheme, DefaultTheme, Stack, ThemeProvider } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import { StatusBar } from "expo-status-bar";
import { useEffect } from "react";
import { useColorScheme } from "react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { ShopProvider } from "@/db/ShopProvider";

export { ErrorBoundary } from "expo-router";

export default function RootLayout() {
  const scheme = useColorScheme();
  useEffect(() => {
    void SplashScreen.hideAsync();
  }, []);
  return (
    <SafeAreaProvider>
      <ThemeProvider value={scheme === "dark" ? DarkTheme : DefaultTheme}>
        <StatusBar style="auto" />
        <ShopProvider>
          <Stack screenOptions={{ headerShown: false }}>
            <Stack.Screen name="(tabs)" />
            <Stack.Screen name="register" />
          </Stack>
        </ShopProvider>
      </ThemeProvider>
    </SafeAreaProvider>
  );
}
