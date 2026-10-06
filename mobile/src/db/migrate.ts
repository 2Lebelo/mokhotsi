import { useMigrations } from 'drizzle-orm/expo-sqlite/migrator';

import migrations from '../../drizzle/migrations';
import { db } from './client';

/**
 * drizzle-orm 1.0.0-rc.4: `useMigrations`' parameter type still declares the 0.x `journal`
 * field, but its runtime only reads `migrations` — which is all drizzle-kit RC generates.
 * The empty journal satisfies the type without changing behaviour.
 */
const bundle = {
  journal: { entries: [] },
  migrations: migrations.migrations,
} satisfies Parameters<typeof useMigrations>[1];

export interface MigrationState {
  ready: boolean;
  error: Error | undefined;
}

/** Applies bundled migrations once per launch. AppProviders renders nothing else until ready. */
export function useDatabaseMigrations(): MigrationState {
  const { success, error } = useMigrations(db, bundle);
  return { ready: success, error };
}
