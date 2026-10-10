import { Redirect } from 'expo-router';

import { useAuth } from '@/features/auth/useAuth';

const ROUTES = {
  signed_in: '/sell',
  must_change_password: '/change-password',
  choose_shop: '/choose-shop',
  signed_out: '/login',
} as const;

export default function Index() {
  const { state } = useAuth();
  if (state.status === 'loading') return null;
  return <Redirect href={ROUTES[state.status]} />;
}
