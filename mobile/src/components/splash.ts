import * as SplashScreen from "expo-splash-screen";

void SplashScreen.preventAutoHideAsync().catch(() => {});

let hidden = false;

/**
 * Hide the native splash once the first real screen is ready (fonts, then device.db), so the
 * app never flashes a loading screen on start. Safe to call more than once.
 */
export function hideSplash(): void {
  if (hidden) return;
  hidden = true;
  void SplashScreen.hideAsync().catch(() => {});
}
