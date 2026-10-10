// expo-crypto is a native module; Node's crypto gives the same RFC 4122 v4 UUIDs in tests.
jest.mock('expo-crypto', () => ({
  randomUUID: () => jest.requireActual<typeof import('node:crypto')>('node:crypto').randomUUID(),
}));

// The structured logger is chatty by design; keep test output readable. Errors still print.
for (const level of ['log', 'info', 'warn'] as const) {
  jest.spyOn(console, level).mockImplementation(() => undefined);
}
