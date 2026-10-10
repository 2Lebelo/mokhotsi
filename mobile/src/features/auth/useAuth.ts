import { useCallback, useContext, useState } from 'react';

import { AuthContext, type AuthContextValue } from '@/providers/AuthProvider';
import type { ShopSummary } from '@/sync/apiClient';

export type { ShopSummary };

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside <AppProviders>');
  return ctx;
}

/** Runs an async action with pending/error state for a form. */
function useSubmit<A extends unknown[]>(action: (...args: A) => Promise<void>) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submit = useCallback(
    async (...args: A) => {
      setPending(true);
      setError(null);
      try {
        await action(...args);
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        setPending(false);
      }
    },
    [action],
  );
  return { submit, pending, error };
}

/** Form state for the login screen. */
export function useLogin() {
  const { signIn, devBypass, state } = useAuth();
  const { submit, pending, error } = useSubmit(signIn);
  const notice = state.status === 'signed_out' ? (state.notice ?? null) : null;
  return { submit, pending, error, notice, devBypass };
}

/** Form state for the first-sign-in "choose your own password" screen. */
export function useChangePassword() {
  const { changePassword, signOut, state } = useAuth();
  const { submit, pending, error } = useSubmit(changePassword);
  const email = state.status === 'must_change_password' ? state.email : '';
  return { submit, pending, error, email, signOut };
}

/** Shop picker shown after sign-in when the account belongs to several shops. */
export function useChooseShop() {
  const { chooseShop, reloadShops, signOut, state } = useAuth();
  const { submit, pending } = useSubmit(chooseShop);
  const shops = state.status === 'choose_shop' ? state.shops : null;
  const error = state.status === 'choose_shop' ? state.error : null;
  return { shops, error, pending, choose: submit, reload: reloadShops, signOut };
}

/** The signed-in shop, for headers and labels. */
export function useCurrentShop(): { shopName: string; email: string; dev: boolean } | null {
  const { state } = useAuth();
  if (state.status !== 'signed_in') return null;
  return { shopName: state.session.shopName, email: state.session.email, dev: state.session.dev };
}
