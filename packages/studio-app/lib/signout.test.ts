import { describe, expect, it, vi } from 'vitest';

vi.mock('expo-crypto', () => ({ randomUUID: () => 'u1' }));
vi.mock('expo-notifications', () => ({
  AndroidImportance: { HIGH: 4, DEFAULT: 3 },
  setBadgeCountAsync: vi.fn(async () => true),
}));
vi.mock('react-native', () => ({
  Platform: { OS: 'ios', select: (o: Record<string, unknown>) => o.ios ?? o.default },
  Linking: { openSettings: vi.fn(async () => {}) },
  AppState: { currentState: 'active', addEventListener: vi.fn(() => ({ remove: vi.fn() })) },
}));
vi.mock('./kv', () => ({ kv: { get: vi.fn(), set: vi.fn(), remove: vi.fn() } }));
vi.mock('./net', () => ({ isOnline: () => true }));
vi.mock('./strings', () => ({ detectLang: () => 'zh' }));
vi.mock('./session', () => ({
  session: { token: () => undefined, snapshot: () => null, clear: vi.fn(), subscribe: () => () => {} },
}));
vi.mock('./client', () => ({
  hub: { logout: vi.fn(async () => ({ ok: true, value: undefined })) },
}));
vi.mock('./todo-store', () => ({
  fetchTodos: vi.fn(async () => ({ todos: [], byProject: {}, fetchedAt: 0, failed: 0 })),
  subscribeTodos: () => () => {},
}));

import { signOut } from './signout';

describe('signOut (SS-165)', () => {
  it('runs unregisterPush with valid token -> hub.logout -> session.clear -> clearBadge in order', async () => {
    const order: string[] = [];
    let currentToken: string | undefined = 'sess-valid-1';

    await signOut({
      getToken: () => currentToken,
      unregisterPush: async (tok) => {
        order.push(`unregister:${tok ?? 'none'}`);
        expect(currentToken).toBe('sess-valid-1');
        return true;
      },
      hubLogout: async () => {
        order.push(`logout:${currentToken ?? 'none'}`);
        currentToken = undefined;
      },
      clearSession: () => {
        order.push('clearSession');
      },
      clearBadge: async () => {
        order.push('clearBadge');
      },
    });

    expect(order).toEqual([
      'unregister:sess-valid-1',
      'logout:sess-valid-1',
      'clearSession',
      'clearBadge',
    ]);
  });
});
