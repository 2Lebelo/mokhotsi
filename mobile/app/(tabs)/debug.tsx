import { Button, StyleSheet, Text, View } from 'react-native';

import { useAuth } from '@/features/auth/useAuth';
import { useDebugInfo } from '@/features/debug/useDebugInfo';
import { useBackupStatus } from '@/features/sync/useBackupStatus';
import { Notice } from '@/features/ui/Notice';
import { Screen } from '@/features/ui/Screen';

export default function DebugScreen() {
  const { rows, syncNow } = useDebugInfo();
  const backup = useBackupStatus();
  const { signOut } = useAuth();
  return (
    <Screen title="Debug">
      <Notice
        tone={backup.unsyncedSales > 0 ? 'warn' : 'info'}
        title={
          backup.unsyncedSales > 0
            ? `${backup.unsyncedSales} sale${backup.unsyncedSales === 1 ? '' : 's'} not yet backed up`
            : 'All sales are backed up'
        }
        body={`${backup.pendingChanges} local change(s) waiting to sync.`}
      />
      {backup.error ? <Notice tone="error" title="Backup status unavailable" body={backup.error} /> : null}
      {backup.needsAttention.length > 0 ? (
        <View style={styles.attention}>
          <Text style={styles.heading}>Needs attention ({backup.needsAttention.length})</Text>
          {backup.needsAttention.map((item) => (
            <View key={item.opId} style={styles.row}>
              <Text style={styles.value}>{item.label}</Text>
              <Text style={styles.label}>{item.reason}</Text>
              <View style={styles.actions}>
                <Button title="Retry" onPress={() => backup.retry([item.opId])} />
                <Button title="Discard" color="#B00020" onPress={() => backup.discard([item.opId])} />
              </View>
            </View>
          ))}
        </View>
      ) : null}
      <Button title="Sync now" onPress={syncNow} />
      {rows.map((r) => (
        <View key={r.label} style={styles.row}>
          <Text style={styles.label}>{r.label}</Text>
          <Text style={styles.value}>{r.value}</Text>
        </View>
      ))}
      <Button title="Sign out" onPress={() => void signOut()} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  attention: { gap: 4 },
  heading: { fontSize: 16, fontWeight: '600' },
  row: { gap: 2, paddingVertical: 6, borderBottomWidth: StyleSheet.hairlineWidth, borderColor: '#DDDDDD' },
  actions: { flexDirection: 'row', gap: 12, paddingTop: 4 },
  label: { fontSize: 12, color: '#666666' },
  value: { fontSize: 14, color: '#1A1A1A' },
});
