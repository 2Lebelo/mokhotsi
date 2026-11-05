import { Stack } from "expo-router";

/** The system admin's screens. The root layout only shows them in the `admin` phase. */
export default function AdminLayout() {
  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="index" />
      <Stack.Screen name="[userId]" />
      <Stack.Screen name="pin" />
    </Stack>
  );
}
