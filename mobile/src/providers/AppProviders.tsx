import type { ReactNode } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { useDatabaseMigrations } from '@/db/migrate';

import { AuthProvider } from './AuthProvider';
import { SyncProvider } from './SyncProvider';

/** Nothing below this renders until the bundled SQLite migrations have been applied. */
function MigrationsGate({ children }: { children: ReactNode }) {
  const { ready, error } = useDatabaseMigrations();
  if (error) {
    return (
      <View style={styles.center}>
        <Text style={styles.title}>Database migration failed</Text>
        <Text style={styles.body}>{error.message}</Text>
      </View>
    );
  }
  if (!ready) {
    return (
      <View style={styles.center}>
        <ActivityIndicator />
        <Text style={styles.body}>Preparing local database…</Text>
      </View>
    );
  }
  return <>{children}</>;
}

export function AppProviders({ children }: { children: ReactNode }) {
  return (
    <SafeAreaProvider>
      <MigrationsGate>
        <AuthProvider>
          <SyncProvider>{children}</SyncProvider>
        </AuthProvider>
      </MigrationsGate>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24, gap: 12 },
  title: { fontSize: 18, fontWeight: '600' },
  body: { fontSize: 14, textAlign: 'center' },
});
