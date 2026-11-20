import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('expo-crypto', () => ({
  randomUUID: vi.fn(() => 'uuid-1234'),
}));

vi.mock('expo-notifications', () => ({
  AndroidImportance: { HIGH: 4, DEFAULT: 3 },
  getPermissionsAsync: vi.fn(async () => ({ granted: true, canAskAgain: true })),
  requestPermissionsAsync: vi.fn(async () => ({ granted: true, canAskAgain: true })),
  getDevicePushTokenAsync: vi.fn(async () => ({ type: 'ios', data: 'apns-token-1' })),
  setNotificationChannelAsync: vi.fn(async () => {}),
}));

vi.mock('react-native', () => ({
  Platform: {
    OS: 'ios',
    select: (obj: Record<string, unknown>) => obj.ios ?? obj.default,
  },
  Linking: { openSettings: vi.fn(async () => {}) },
  AppState: { currentState: 'active', addEventListener: vi.fn(() => ({ remove: vi.fn() })) },
}));

vi.mock('./kv', () => ({
  kv: {
    get: vi.fn(),
    set: vi.fn(),
    remove: vi.fn(),
  },
}));

vi.mock('./session', () => ({
  session: {
    snapshot: () => null,
    subscribe: () => () => {},
  },
}));

vi.mock('./net', () => ({
  isOnline: () => true,
}));

vi.mock('./strings', () => ({
  detectLang: () => 'zh',
}));

import {
  deniedPermissionHint,
  initPushRegistration,
  registerPush,
  setPushEnabled,
  unregisterPush,
  type PushDeps,
  type PushNotificationsApi,
} from './push';

function makeMemoryKv() {
  const map = new Map<string, unknown>();
  return {
    get: <T,>(k: string) => map.get(k) as T | undefined,
    set: (k: string, v: unknown) => {
      map.set(k, v);
    },
    remove: (k: string) => {
      map.delete(k);
    },
  };
}

function makeNotifications(overrides: Partial<PushNotificationsApi> = {}): PushNotificationsApi {
  return {
    AndroidImportance: { HIGH: 4, DEFAULT: 3 },
    getPermissionsAsync: vi.fn(async () => ({ granted: true, canAskAgain: true })),
    requestPermissionsAsync: vi.fn(async () => ({ granted: true, canAskAgain: true })),
    getDevicePushTokenAsync: vi.fn(async () => ({ type: 'ios', data: 'apns-tok-xyz' })),
    setNotificationChannelAsync: vi.fn(async () => {}),
    ...overrides,
  };
}

describe('push registration', () => {
  let memKv: ReturnType<typeof makeMemoryKv>;

  beforeEach(() => {
    memKv = makeMemoryKv();
  });

  it('registers native device token with hub and skips duplicate POST when unchanged', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ ok: true }), { status: 200 }));
    const deps: PushDeps = {
      kv: memKv,
      notifications: makeNotifications(),
      fetch: fetchMock as unknown as typeof fetch,
      getToken: () => 'sess-1',
      baseUrl: 'https://hub.example.com',
      platform: 'ios',
      randomId: () => 'dev-1',
      isOnline: () => true,
      isDemo: () => false,
    };

    const first = await registerPush({ askPermission: true }, deps);
    expect(first).toEqual({
      ok: true,
      status: 'registered',
      device: 'app-dev-1',
      token: 'apns-tok-xyz',
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith(
      'https://hub.example.com/v1/app/push-tokens',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ device: 'app-dev-1', platform: 'ios', token: 'apns-tok-xyz' }),
      }),
    );

    const second = await registerPush({ askPermission: true }, deps);
    expect(second).toEqual({
      ok: true,
      status: 'cached',
      device: 'app-dev-1',
      token: 'apns-tok-xyz',
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('returns settings › notifications instructions when permission is denied', async () => {
    const notifications = makeNotifications({
      getPermissionsAsync: vi.fn(async () => ({ granted: false, canAskAgain: true })),
      requestPermissionsAsync: vi.fn(async () => ({ granted: false, canAskAgain: false })),
    });
    const fetchMock = vi.fn();
    const res = await registerPush(
      { askPermission: true },
      {
        kv: memKv,
        notifications,
        fetch: fetchMock as unknown as typeof fetch,
        getToken: () => 'sess-1',
        platform: 'ios',
        lang: 'zh',
        isDemo: () => false,
      },
    );

    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.reason).toBe('denied');
      expect(res.hint).toBe(deniedPermissionHint('zh', 'ios'));
      expect(res.hint).toContain('设置');
      expect(res.hint).toContain('通知');
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('respects me-account pushEnabled toggle and unregisters on logout', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ ok: true }), { status: 200 }));
    let token: string | null = 'sess-1';
    let sessionCb: (() => void) | undefined;

    const deps: PushDeps = {
      kv: memKv,
      notifications: makeNotifications(),
      fetch: fetchMock as unknown as typeof fetch,
      getToken: () => token,
      subscribeSession: (cb) => {
        sessionCb = cb;
        return vi.fn();
      },
      baseUrl: 'https://hub.example.com',
      platform: 'android',
      randomId: () => 'dev-2',
      isOnline: () => true,
      isDemo: () => false,
    };

    const stop = initPushRegistration(deps);
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));

    // Turning off me-account toggle unregisters immediately and blocks further registration.
    await setPushEnabled(false, deps);
    expect(fetchMock).toHaveBeenLastCalledWith(
      'https://hub.example.com/v1/app/push-tokens',
      expect.objectContaining({ method: 'DELETE' }),
    );
    const blocked = await registerPush({ askPermission: true }, deps);
    expect(blocked).toEqual({ ok: false, reason: 'disabled' });

    // Re-enabling re-registers, and logging out sends DELETE using the previous session token.
    await setPushEnabled(true, deps);
    expect(fetchMock).toHaveBeenLastCalledWith(
      'https://hub.example.com/v1/app/push-tokens',
      expect.objectContaining({ method: 'POST' }),
    );

    token = null;
    sessionCb?.();
    await vi.waitFor(() =>
      expect(fetchMock).toHaveBeenLastCalledWith(
        'https://hub.example.com/v1/app/push-tokens',
        expect.objectContaining({
          method: 'DELETE',
          headers: expect.objectContaining({ authorization: 'Bearer sess-1' }),
        }),
      ),
    );

    // Explicit unregisterPush works cleanly even when nothing is cached.
    await expect(unregisterPush('sess-1', deps)).resolves.toBe(true);
    stop();
  });
});
