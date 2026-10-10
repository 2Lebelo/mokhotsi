import { useState } from 'react';
import { Button, StyleSheet, TextInput } from 'react-native';

import { useLogin } from '@/features/auth/useAuth';
import { Notice } from '@/features/ui/Notice';
import { Screen } from '@/features/ui/Screen';

export default function LoginScreen() {
  const { submit, pending, error, notice, devBypass } = useLogin();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');

  return (
    <Screen title="Mokhotsi">
      {notice ? <Notice tone="warn" title="Signed out" body={notice} /> : null}
      <TextInput
        style={styles.input}
        placeholder="Email"
        keyboardType="email-address"
        autoCapitalize="none"
        autoComplete="email"
        autoCorrect={false}
        value={email}
        onChangeText={setEmail}
        accessibilityLabel="Email"
      />
      <TextInput
        style={styles.input}
        placeholder="Password"
        secureTextEntry
        autoComplete="current-password"
        value={password}
        onChangeText={setPassword}
        onSubmitEditing={() => void submit(email, password)}
        accessibilityLabel="Password"
      />
      <Button
        title={pending ? 'Signing in…' : 'Sign in'}
        disabled={pending || !email || !password}
        onPress={() => void submit(email, password)}
      />
      {error ? <Notice tone="error" title="Sign-in failed" body={error} /> : null}
      {devBypass ? (
        <>
          <Notice
            tone="warn"
            title="Development build"
            body="Skip sign-in to try the screens offline. Nothing you do in this mode is synced."
          />
          <Button title="Skip sign-in (dev only)" onPress={devBypass} />
        </>
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  input: {
    borderWidth: 1,
    borderColor: '#CCCCCC',
    borderRadius: 8,
    padding: 12,
    fontSize: 16,
    minHeight: 48,
  },
});
