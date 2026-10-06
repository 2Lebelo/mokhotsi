import { useState } from 'react';
import { Button, StyleSheet, TextInput } from 'react-native';

import { useLogin } from '@/features/auth/useAuth';
import { Notice } from '@/features/ui/Notice';
import { Screen } from '@/features/ui/Screen';

export default function LoginScreen() {
  const { submit, pending, error, devBypass } = useLogin();
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');

  return (
    <Screen title="Mokhotsi">
      <TextInput
        style={styles.input}
        placeholder="Owner phone"
        keyboardType="phone-pad"
        autoComplete="tel"
        value={phone}
        onChangeText={setPhone}
      />
      <TextInput
        style={styles.input}
        placeholder="Password"
        secureTextEntry
        value={password}
        onChangeText={setPassword}
      />
      <Button
        title={pending ? 'Signing in…' : 'Sign in'}
        disabled={pending}
        onPress={() => submit(phone, password)}
      />
      {error ? <Notice tone="error" title="Sign-in failed" body={error} /> : null}
      {devBypass ? (
        <>
          <Notice
            tone="warn"
            title="Development build"
            body="Sign-in is not implemented yet. Skip it to see the placeholder screens."
          />
          <Button title="Skip sign-in (dev only)" onPress={devBypass} />
        </>
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  input: { borderWidth: 1, borderColor: '#CCCCCC', borderRadius: 8, padding: 12, fontSize: 16 },
});
