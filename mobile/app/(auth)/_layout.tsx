import { Stack } from 'expo-router';

import { useAuth } from '@/features/auth/useAuth';

/** Each sign-in step is reachable only in its own auth state. */
export default function AuthLayout() {
  const { state } = useAuth();
  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Protected guard={state.status === 'signed_out' || state.status === 'loading'}>
        <Stack.Screen name="login" />
      </Stack.Protected>
      <Stack.Protected guard={state.status === 'must_change_password'}>
        <Stack.Screen name="change-password" />
      </Stack.Protected>
      <Stack.Protected guard={state.status === 'choose_shop'}>
        <Stack.Screen name="choose-shop" />
      </Stack.Protected>
    </Stack>
  );
}
