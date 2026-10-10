import { SessionStore } from '@/features/auth/session';
import type { StoredSession } from '@/features/auth/tokenStore';
import { ApiError, NetworkError } from '@/sync/apiClient';

jest.mock('expo-secure-store', () => ({
  getItemAsync: jest.fn(),
  setItemAsync: jest.fn(),
  deleteItemAsync: jest.fn(),
}));

const SESSION: StoredSession = {
  userId: 'u',
  email: 'keeper@example.com',
  name: 'Keeper',
  accessToken: 'access-1',
  refreshToken: 'refresh-1',
  mustChangePassword: false,
  shopId: 'shop',
  shopName: 'Main Shop',
};

function makeStore(
  refreshTokens: (token: string) => Promise<{ access_token: string; refresh_token: string }>,
) {
  const onExpired = jest.fn();
  const store = new SessionStore({ refreshTokens, onExpired, persist: async () => undefined });
  return { store, onExpired };
}

it('shares one refresh between concurrent 401s (refresh tokens are single use)', async () => {
  const refreshTokens = jest.fn(async () => ({ access_token: 'access-2', refresh_token: 'refresh-2' }));
  const { store } = makeStore(refreshTokens);
  await store.set(SESSION);

  const tokens = await Promise.all([store.refresh(), store.refresh(), store.refresh()]);

  expect(tokens).toEqual(['access-2', 'access-2', 'access-2']);
  expect(refreshTokens).toHaveBeenCalledTimes(1);
  expect(refreshTokens).toHaveBeenCalledWith('refresh-1');
  expect(store.get()).toMatchObject({ accessToken: 'access-2', refreshToken: 'refresh-2' });
});

it('signs out when the server refuses the refresh token', async () => {
  const { store, onExpired } = makeStore(async () => {
    throw new ApiError(401, { error: { code: 'session_revoked', message: 'revoked' } });
  });
  await store.set(SESSION);
  await expect(store.refresh()).resolves.toBeNull();
  expect(store.get()).toBeNull();
  expect(onExpired).toHaveBeenCalledTimes(1);
});

it('keeps the session when offline (selling must keep working)', async () => {
  const { store, onExpired } = makeStore(async () => {
    throw new NetworkError('offline');
  });
  await store.set(SESSION);
  await expect(store.refresh()).rejects.toBeInstanceOf(NetworkError);
  expect(store.get()).toEqual(SESSION);
  expect(onExpired).not.toHaveBeenCalled();
});
