import { useCallback, useContext, useState } from 'react';

import { AuthContext, type AuthContextValue } from '@/providers/AuthProvider';

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside <AppProviders>');
  return ctx;
}

/** Form state for the login screen. */
export function useLogin() {
  const { signIn, devBypass } = useAuth();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = useCallback(
    async (ownerPhone: string, password: string) => {
      setPending(true);
      setError(null);
      try {
        await signIn(ownerPhone, password);
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        setPending(false);
      }
    },
    [signIn],
  );

  return { submit, pending, error, devBypass };
}
