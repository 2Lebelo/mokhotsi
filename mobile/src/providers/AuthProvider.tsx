import { createContext, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';

import { getOrCreateDeviceId, getSyncValue, resetLocalData, setSyncValue } from '@/db/repositories/syncState';
import { SessionStore } from '@/features/auth/session';
import { readSession, type StoredSession } from '@/features/auth/tokenStore';
import { getConfig } from '@/lib/config';
import { createLogger } from '@/lib/logger';
import { ApiError, createApiClient, NetworkError, type ApiClient, type ShopSummary } from '@/sync/apiClient';

const log = createLogger('auth');

/** Local data written by the __DEV__ bypass belongs to this pseudo shop and is never synced. */
const DEV_SHOP_ID = 'dev-shop';

export interface Session {
  userId: string;
  email: string;
  name: string;
  shopId: string;
  shopName: string;
  /** True for the __DEV__-only bypass session (no backend). */
  dev: boolean;
}

export type AuthState =
  | { status: 'loading' }
  | { status: 'signed_out'; notice?: string }
  | { status: 'must_change_password'; email: string }
  | { status: 'choose_shop'; shops: ShopSummary[] | null; error: string | null }
  | { status: 'signed_in'; session: Session };

export interface AuthContextValue {
  state: AuthState;
  /** Shared API client (null when the build has no valid API_URL). */
  api: ApiClient | null;
  /** Session store for token refresh; null until a client exists. */
  sessionStore: SessionStore | null;
  signIn(email: string, password: string): Promise<void>;
  changePassword(currentPassword: string, newPassword: string): Promise<void>;
  reloadShops(): Promise<void>;
  chooseShop(shop: ShopSummary): Promise<void>;
  signOut(): Promise<void>;
  /** Called when the server refuses the session (refresh token spent, revoked or expired). */
  expire(): void;
  /** __DEV__ only: enter the app without a backend so the screens are reachable. */
  devBypass: (() => void) | undefined;
}

export const AuthContext = createContext<AuthContextValue | null>(null);

/** A message a shop owner can act on. */
export function describeAuthError(error: unknown, apiUrl?: string): string {
  if (error instanceof NetworkError) {
    return `Cannot reach the server${apiUrl ? ` at ${apiUrl}` : ''}. Check the Wi-Fi or data connection.`;
  }
  if (error instanceof ApiError) {
    if (error.status === 401) return 'Wrong email or password.';
    if (error.status === 423) return 'This account is locked for a while after too many attempts.';
    if (error.status === 429) return 'Too many attempts. Wait a minute and try again.';
    return error.message;
  }
  return error instanceof Error ? error.message : String(error);
}

function toSession(stored: StoredSession): Session | null {
  if (!stored.shopId) return null;
  return {
    userId: stored.userId,
    email: stored.email,
    name: stored.name,
    shopId: stored.shopId,
    shopName: stored.shopName ?? '',
    dev: false,
  };
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>({ status: 'loading' });
  const expireRef = useRef<() => void>(() => undefined);

  // One API client and session store per app run. A broken API_URL leaves both null and the
  // login screen explains why.
  const { api, sessionStore, configError } = useMemo(() => {
    try {
      const { apiUrl } = getConfig();
      let store: SessionStore | null = null;
      const client = createApiClient({
        baseUrl: apiUrl,
        auth: {
          getAccessToken: () => store?.getAccessToken() ?? null,
          refresh: () => store?.refresh() ?? Promise.resolve(null),
        },
      });
      store = new SessionStore({
        refreshTokens: (token) => client.refreshTokens(token),
        onExpired: () => expireRef.current(),
      });
      return { api: client, sessionStore: store, configError: null };
    } catch (error) {
      return { api: null, sessionStore: null, configError: describeAuthError(error) };
    }
  }, []);

  const expire = useCallback(() => {
    void sessionStore?.set(null);
    setState({ status: 'signed_out', notice: 'Your session expired. Sign in again.' });
  }, [sessionStore]);
  expireRef.current = expire;

  const selectShop = useCallback(
    async (shop: ShopSummary) => {
      if (!sessionStore) throw new Error('not signed in');
      const localShop = getSyncValue('shop_id');
      if (localShop !== shop.id) {
        // Another shop's local copy (or none): start clean. Throws if unsynced changes exist,
        // except for __DEV__ bypass data, which can never be synced anyway.
        resetLocalData({ discardUnsynced: localShop === DEV_SHOP_ID });
        setSyncValue('shop_id', shop.id);
      }
      const stored = await sessionStore.update({ shopId: shop.id, shopName: shop.name });
      setState({ status: 'signed_in', session: toSession(stored)! });
    },
    [sessionStore],
  );

  const loadShops = useCallback(async () => {
    if (!api) return;
    setState({ status: 'choose_shop', shops: null, error: null });
    try {
      const shops = (await api.listShops()).filter((s) => s.status === 'active');
      if (shops.length === 1) {
        await selectShop(shops[0]!);
      } else {
        setState({
          status: 'choose_shop',
          shops,
          error: shops.length === 0 ? 'Your account does not belong to any active shop yet.' : null,
        });
      }
    } catch (error) {
      setState({ status: 'choose_shop', shops: null, error: describeAuthError(error, getConfig().apiUrl) });
    }
  }, [api, selectShop]);

  // Restore the stored session. Works offline: tokens are only checked on the next request.
  useEffect(() => {
    let cancelled = false;
    readSession()
      .then(async (stored) => {
        if (cancelled || !sessionStore) return;
        if (!stored) {
          setState({ status: 'signed_out' });
          return;
        }
        await sessionStore.set(stored);
        if (stored.mustChangePassword) {
          setState({ status: 'must_change_password', email: stored.email });
        } else if (stored.shopId && getSyncValue('shop_id') === stored.shopId) {
          setState({ status: 'signed_in', session: toSession(stored)! });
        } else {
          await loadShops();
        }
      })
      .catch((error: unknown) => {
        log.error('session restore failed', { error: String(error) });
        if (!cancelled) setState({ status: 'signed_out' });
      });
    if (!sessionStore) setState({ status: 'signed_out', notice: configError ?? undefined });
    return () => {
      cancelled = true;
    };
    // Runs once per launch; loadShops is stable for the app's lifetime.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const signIn = useCallback(
    async (email: string, password: string) => {
      if (!api || !sessionStore) throw new Error(configError ?? 'API is not configured');
      let tokens;
      try {
        tokens = await api.login(email.trim(), password, getOrCreateDeviceId());
      } catch (error) {
        throw new Error(describeAuthError(error, getConfig().apiUrl));
      }
      await sessionStore.set({
        userId: tokens.user.id,
        email: tokens.user.email,
        name: tokens.user.name,
        accessToken: tokens.access_token,
        refreshToken: tokens.refresh_token,
        mustChangePassword: tokens.user.must_change_password,
        shopId: null,
        shopName: null,
      });
      if (tokens.user.must_change_password) {
        setState({ status: 'must_change_password', email: tokens.user.email });
        return;
      }
      await loadShops();
    },
    [api, sessionStore, configError, loadShops],
  );

  const changePassword = useCallback(
    async (currentPassword: string, newPassword: string) => {
      if (!api || !sessionStore) throw new Error('not signed in');
      try {
        await api.changePassword(currentPassword, newPassword);
      } catch (error) {
        if (error instanceof ApiError && error.status === 422) {
          throw new Error('The new password must be 8–128 characters and differ from the old one.');
        }
        throw new Error(describeAuthError(error, getConfig().apiUrl));
      }
      await sessionStore.update({ mustChangePassword: false });
      await loadShops();
    },
    [api, sessionStore, loadShops],
  );

  const chooseShop = useCallback(
    async (shop: ShopSummary) => {
      try {
        await selectShop(shop);
      } catch (error) {
        setState((s) => (s.status === 'choose_shop' ? { ...s, error: describeAuthError(error) } : s));
      }
    },
    [selectShop],
  );

  const signOut = useCallback(async () => {
    // Best effort: revoke the session server-side; never block signing out on the network.
    api?.revokeCurrentSession().catch(() => undefined);
    await sessionStore?.set(null);
    setState({ status: 'signed_out' });
  }, [api, sessionStore]);

  const devBypass = useMemo(
    () =>
      __DEV__
        ? () => {
            log.warn('using __DEV__ auth bypass (local only, nothing syncs)');
            const localShop = getSyncValue('shop_id');
            if (localShop !== DEV_SHOP_ID) {
              try {
                resetLocalData();
                setSyncValue('shop_id', DEV_SHOP_ID);
              } catch (error) {
                setState({ status: 'signed_out', notice: describeAuthError(error) });
                return;
              }
            }
            setState({
              status: 'signed_in',
              session: {
                userId: 'dev-user',
                email: 'dev@localhost',
                name: 'Developer',
                shopId: DEV_SHOP_ID,
                shopName: 'Dev shop (offline only)',
                dev: true,
              },
            });
          }
        : undefined,
    [],
  );

  const value = useMemo<AuthContextValue>(
    () => ({
      state,
      api,
      sessionStore,
      signIn,
      changePassword,
      reloadShops: loadShops,
      chooseShop,
      signOut,
      expire,
      devBypass,
    }),
    [state, api, sessionStore, signIn, changePassword, loadShops, chooseShop, signOut, expire, devBypass],
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
