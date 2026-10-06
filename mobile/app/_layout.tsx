import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';

import { useAuth } from '@/features/auth/useAuth';
import { AppProviders } from '@/providers/AppProviders';

function RootNavigator() {
  const { state } = useAuth();
  if (state.status === 'loading') return null;
  const signedIn = state.status === 'signed_in';
  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Protected guard={signedIn}>
        <Stack.Screen name="(tabs)" />
        <Stack.Screen name="enrol/[productId]" options={{ headerShown: true, title: 'Enrol product' }} />
      </Stack.Protected>
      <Stack.Protected guard={!signedIn}>
        <Stack.Screen name="(auth)" />
      </Stack.Protected>
    </Stack>
  );
}

export default function RootLayout() {
  return (
    <AppProviders>
      <StatusBar style="dark" />
      <RootNavigator />
    </AppProviders>
  );
}
