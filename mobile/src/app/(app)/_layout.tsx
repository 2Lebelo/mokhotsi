import { Stack } from "expo-router";
import { useMemo } from "react";
import { View } from "react-native";

import { useDevice } from "@/auth/device-provider";
import { useSession } from "@/auth/session-provider";
import { ui } from "@/components/shop-ui";
import { ShopProvider } from "@/db/ShopProvider";
import type { Actor } from "@/db/store";
import { VisionProvider } from "@/features/vision/vision-provider";

/**
 * Everything behind the PIN: one shop's data (its own SQLite file), opened as the person who
 * unlocked. The root layout only shows this group in the `open` phase.
 */
export default function AppLayout() {
  const { device } = useDevice();
  const { till, touch } = useSession();
  const shopId = till.kind === "open" ? till.shop.id : null;
  const userId = till.kind === "open" ? till.member.userId : null;
  const deviceId = device.deviceId();
  const actor = useMemo<Actor | null>(
    () => (userId && deviceId ? { userId, deviceId } : null),
    [userId, deviceId],
  );
  if (!shopId || !actor) return null; // Guarded by the root layout; never shown.

  return (
    // Any touch postpones the idle lock.
    <View style={ui.flex} onTouchStart={touch}>
      <ShopProvider key={shopId} databaseName={device.databaseFor(shopId)} actor={actor}>
        <VisionProvider>
          <Stack screenOptions={{ headerShown: false }}>
            <Stack.Screen name="(tabs)" />
            <Stack.Screen name="register" />
            <Stack.Screen name="identify" />
            <Stack.Screen name="sales" />
            <Stack.Screen name="reports" />
            <Stack.Screen name="users" />
            <Stack.Screen name="shops" />
            <Stack.Screen name="pin" />
          </Stack>
        </VisionProvider>
      </ShopProvider>
    </View>
  );
}
