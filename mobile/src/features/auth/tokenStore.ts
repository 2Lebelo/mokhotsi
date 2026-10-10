import * as SecureStore from 'expo-secure-store';

const SESSION_KEY = 'mokhotsi.session.v2';
const LEGACY_KEYS = ['mokhotsi.session.v1'];

/** What survives an app restart. Tokens live only in the OS keystore, never in SQLite. */
export interface StoredSession {
  userId: string;
  email: string;
  name: string;
  accessToken: string;
  refreshToken: string;
  mustChangePassword: boolean;
  /** The shop this phone syncs; null until chosen. */
  shopId: string | null;
  shopName: string | null;
}

function isStoredSession(value: unknown): value is StoredSession {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.userId === 'string' &&
    typeof v.accessToken === 'string' &&
    typeof v.refreshToken === 'string' &&
    typeof v.mustChangePassword === 'boolean' &&
    (v.shopId === null || typeof v.shopId === 'string')
  );
}

export async function readSession(): Promise<StoredSession | null> {
  for (const key of LEGACY_KEYS) await SecureStore.deleteItemAsync(key);
  const raw = await SecureStore.getItemAsync(SESSION_KEY);
  if (!raw) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (isStoredSession(parsed)) return parsed;
  } catch {
    // Fall through: a corrupt entry is dropped.
  }
  await SecureStore.deleteItemAsync(SESSION_KEY);
  return null;
}

export function writeSession(session: StoredSession): Promise<void> {
  return SecureStore.setItemAsync(SESSION_KEY, JSON.stringify(session));
}

export function clearSession(): Promise<void> {
  return SecureStore.deleteItemAsync(SESSION_KEY);
}
