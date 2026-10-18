import { useIsFocused } from "expo-router";
import { useEffect, useState } from "react";
import { AppState } from "react-native";

/**
 * Whether a camera preview may run: its screen is focused and the app is in the
 * foreground. Only one preview can be active at a time, and tab screens stay
 * mounted in the background, so previews must unmount when this is false.
 */
export function useCameraVisibility(): boolean {
  const focused = useIsFocused();
  const [foreground, setForeground] = useState(
    AppState.currentState === "active",
  );
  useEffect(() => {
    const subscription = AppState.addEventListener("change", (state) =>
      setForeground(state === "active"),
    );
    return () => subscription.remove();
  }, []);
  return focused && foreground;
}
