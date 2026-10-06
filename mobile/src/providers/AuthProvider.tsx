import { createContext, useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';

import { clearSession, readSession } from '@/features/auth/tokenStore';
import { notImplemented } from '@/lib/errors';
import { createLogger } from '@/lib/logger';

const log = createLogger('auth');

export interface Session {
  shopId: string;
  accessToken: string;
  /** True for the __DEV__-only bypass session (no backend). */
  dev: boolean;
}

export type AuthState =
  { status: 'loading' } | { status: 'signed_out' } | { status: 'signed_in'; session: Session };

export interface AuthContextValue {
  state: AuthState;
  signIn(ownerPhone: string, password: string): Promise<void>;
  signOut(): Promise<void>;
  /** __DEV__ only: enter the app without a backend so placeholder screens are reachable. */
  devBypass: (() => void) | undefined;
}

export const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>({ status: 'loading' });

  useEffect(() => {
    let cancelled = false;
    readSession()
      .then((stored) => {
        if (cancelled) return;
        // TODO(feature): validate/refresh the stored session via POST /auth/refresh before trusting it.
        setState(
          stored
            ? {
                status: 'signed_in',
                session: { shopId: stored.shopId, accessToken: stored.accessToken, dev: false },
              }
            : { status: 'signed_out' },
        );
      })
      .catch((error: unknown) => {
        log.error('session restore failed', { error: String(error) });
        if (!cancelled) setState({ status: 'signed_out' });
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const signIn = useCallback(async (ownerPhone: string, password: string) => {
    // TODO(feature): POST /auth/login { owner_phone, password, device_id } → writeSession(tokens) → setState(signed_in).
    notImplemented(`auth.signIn (${ownerPhone.length} digit phone, ${password.length} char password)`);
  }, []);

  const signOut = useCallback(async () => {
    await clearSession();
    setState({ status: 'signed_out' });
  }, []);

  const devBypass = useMemo(
    () =>
      __DEV__
        ? () => {
            // TODO(feature): remove once /auth/login works end to end.
            log.warn('using __DEV__ auth bypass');
            setState({ status: 'signed_in', session: { shopId: 'dev-shop', accessToken: '', dev: true } });
          }
        : undefined,
    [],
  );

  const value = useMemo<AuthContextValue>(
    () => ({ state, signIn, signOut, devBypass }),
    [state, signIn, signOut, devBypass],
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
