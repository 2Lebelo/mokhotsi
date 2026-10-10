import { useState } from 'react';
import { Button, StyleSheet, Text, TextInput } from 'react-native';

import { useChangePassword } from '@/features/auth/useAuth';
import { Notice } from '@/features/ui/Notice';
import { Screen } from '@/features/ui/Screen';

const MIN_LENGTH = 8;

export default function ChangePasswordScreen() {
  const { submit, pending, error, email, signOut } = useChangePassword();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const mismatch = confirm.length > 0 && next !== confirm;
  const canSubmit = !pending && current.length > 0 && next.length >= MIN_LENGTH && next === confirm;

  return (
    <Screen title="Choose your password">
      <Text style={styles.text}>
        {email} was created with a temporary password. Choose your own before you continue.
      </Text>
      <TextInput
        style={styles.input}
        placeholder="Temporary password"
        secureTextEntry
        value={current}
        onChangeText={setCurrent}
        accessibilityLabel="Temporary password"
      />
      <TextInput
        style={styles.input}
        placeholder={`New password (at least ${MIN_LENGTH} characters)`}
        secureTextEntry
        autoComplete="new-password"
        value={next}
        onChangeText={setNext}
        accessibilityLabel="New password"
      />
      <TextInput
        style={styles.input}
        placeholder="Repeat new password"
        secureTextEntry
        value={confirm}
        onChangeText={setConfirm}
        accessibilityLabel="Repeat new password"
      />
      {mismatch ? <Notice tone="warn" title="The new passwords do not match" /> : null}
      <Button
        title={pending ? 'Saving…' : 'Save password'}
        disabled={!canSubmit}
        onPress={() => void submit(current, next)}
      />
      {error ? <Notice tone="error" title="Could not change the password" body={error} /> : null}
      <Button title="Sign out" onPress={() => void signOut()} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  text: { fontSize: 15, color: '#333333' },
  input: {
    borderWidth: 1,
    borderColor: '#CCCCCC',
    borderRadius: 8,
    padding: 12,
    fontSize: 16,
    minHeight: 48,
  },
});
