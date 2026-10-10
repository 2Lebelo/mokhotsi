import { createLogger } from '@/lib/logger';
import { ApiError, type AuthHooks } from '@/sync/apiClient';

import { clearSession, writeSession, type StoredSession } from './tokenStore';

const log = createLogger('auth.session');

export interface SessionStoreOptions {
  /** POST /api/v1/tokens with grant_type=refresh_token. */
  refreshTokens(refreshToken: string): Promise<{ access_token: string; refresh_token: string }>;
  /** Called once when the server refuses the refresh token (sign in again). */
  onExpired(): void;
  /** Injected in tests; defaults to the OS keystore. */
  persist?: (session: StoredSession | null) => Promise<void>;
}

/**
 * Holds the signed-in session in memory (persisted to the keystore on every change) and renews
 * the access token. Refresh tokens are single use, so concurrent 401s must share ONE refresh:
 * a second refresh with the already-spent token would revoke the whole session server-side.
 */
export class SessionStore implements AuthHooks {
  private current: StoredSession | null = null;
  private refreshing: Promise<string | null> | null = null;
  private readonly persist: (session: StoredSession | null) => Promise<void>;

  constructor(private readonly options: SessionStoreOptions) {
    this.persist = options.persist ?? ((s) => (s ? writeSession(s) : clearSession()));
  }

  get(): StoredSession | null {
    return this.current;
  }

  async set(session: StoredSession | null): Promise<void> {
    this.current = session;
    await this.persist(session);
  }

  async update(patch: Partial<StoredSession>): Promise<StoredSession> {
    if (!this.current) throw new Error('not signed in');
    const next = { ...this.current, ...patch };
    await this.set(next);
    return next;
  }

  getAccessToken(): string | null {
    return this.current?.accessToken ?? null;
  }

  refresh(): Promise<string | null> {
    this.refreshing ??= this.doRefresh().finally(() => {
      this.refreshing = null;
    });
    return this.refreshing;
  }

  private async doRefresh(): Promise<string | null> {
    const session = this.current;
    if (!session) return null;
    try {
      const tokens = await this.options.refreshTokens(session.refreshToken);
      // The user may have signed out while the request was in flight.
      if (this.current?.refreshToken !== session.refreshToken) return null;
      await this.update({ accessToken: tokens.access_token, refreshToken: tokens.refresh_token });
      return tokens.access_token;
    } catch (error) {
      if (error instanceof ApiError && (error.status === 401 || error.status === 400)) {
        log.warn('refresh token refused; signing out', { code: error.code });
        await this.set(null);
        this.options.onExpired();
        return null;
      }
      throw error; // Offline or server error: keep the session, the caller retries later.
    }
  }
}
