import { Redirect } from 'expo-router';

import { useAuth } from '@/features/auth/useAuth';

export default function Index() {
  const { state } = useAuth();
  if (state.status === 'loading') return null;
  return <Redirect href={state.status === 'signed_in' ? '/sell' : '/login'} />;
}
