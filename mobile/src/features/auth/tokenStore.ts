import * as SecureStore from 'expo-secure-store';

const SESSION_KEY = 'mokhotsi.session.v1';

/** What survives an app restart. Tokens live only in the OS keystore, never in SQLite. */
export interface StoredSession {
  shopId: string;
  accessToken: string;
  refreshToken: string;
}

export async function readSession(): Promise<StoredSession | null> {
  const raw = await SecureStore.getItemAsync(SESSION_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as StoredSession;
  } catch {
    await SecureStore.deleteItemAsync(SESSION_KEY);
    return null;
  }
}

export function writeSession(session: StoredSession): Promise<void> {
  return SecureStore.setItemAsync(SESSION_KEY, JSON.stringify(session));
}

export function clearSession(): Promise<void> {
  return SecureStore.deleteItemAsync(SESSION_KEY);
}
