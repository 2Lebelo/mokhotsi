import { Button, StyleSheet, Text, View } from 'react-native';

import { useAuth } from '@/features/auth/useAuth';
import { useDebugInfo } from '@/features/debug/useDebugInfo';
import { Screen } from '@/features/ui/Screen';

export default function DebugScreen() {
  const { rows, syncNow } = useDebugInfo();
  const { signOut } = useAuth();
  return (
    <Screen title="Debug">
      {rows.map((r) => (
        <View key={r.label} style={styles.row}>
          <Text style={styles.label}>{r.label}</Text>
          <Text style={styles.value}>{r.value}</Text>
        </View>
      ))}
      <Button title="Sync now" onPress={syncNow} />
      <Button title="Sign out" onPress={() => void signOut()} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  row: { gap: 2, paddingVertical: 6, borderBottomWidth: StyleSheet.hairlineWidth, borderColor: '#DDDDDD' },
  label: { fontSize: 12, color: '#666666' },
  value: { fontSize: 14, color: '#1A1A1A' },
});
