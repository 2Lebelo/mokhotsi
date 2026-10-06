import { useContext } from 'react';

import { SyncContext, type SyncContextValue } from '@/providers/SyncProvider';

export function useSync(): SyncContextValue {
  const ctx = useContext(SyncContext);
  if (!ctx) throw new Error('useSync must be used inside <AppProviders>');
  return ctx;
}
