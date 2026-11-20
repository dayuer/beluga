import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('expo-notifications', () => ({
  DEFAULT_ACTION_IDENTIFIER: 'expo.modules.notifications.actions.DEFAULT',
  addNotificationResponseReceivedListener: vi.fn(() => ({ remove: vi.fn() })),
  getLastNotificationResponseAsync: vi.fn(async () => null),
}));

vi.mock('expo-router', () => ({
  router: { push: vi.fn() },
}));

vi.mock('react-native', () => ({
  Platform: { OS: 'ios' },
}));

import {
  extractPushPath,
  initPushOpen,
  resetPushOpenForTest,
  type NotificationResponseLike,
  type NotificationsOpenApi,
} from './push-open';

function makeResponse(
  id: string,
  data: unknown,
  actionIdentifier = 'expo.modules.notifications.actions.DEFAULT',
): NotificationResponseLike {
  return {
    actionIdentifier,
    notification: {
      request: {
        identifier: id,
        content: { data },
      },
    },
  };
}

describe('extractPushPath', () => {
  it('extracts and normalizes /request/<id>?card=<cardId> from payload.path', () => {
    const res = makeResponse('n1', {
      projectId: 'proj-1',
      planRef: 'req-42',
      cardId: 'card-7',
      path: '/request/req-42?card=card-7',
    });
    expect(extractPushPath(res)).toBe('/request/req-42?card=card-7');
  });

  it('accepts synon:// and matching https:// hub links via lib/links', () => {
    const hubUrl = 'https://studio.example.com';
    expect(extractPushPath(makeResponse('n2', { path: 'synon://request/req-9?card=c1' }), hubUrl)).toBe(
      '/request/req-9?card=c1',
    );
    expect(
      extractPushPath(makeResponse('n3', { path: 'https://studio.example.com/request/req-9?card=c1' }), hubUrl),
    ).toBe('/request/req-9?card=c1');
    expect(
      extractPushPath(makeResponse('n4', { path: 'https://evil.example.com/request/req-9?card=c1' }), hubUrl),
    ).toBeNull();
  });

  it('ignores non-default actions and invalid payloads', () => {
    expect(extractPushPath(makeResponse('n5', { path: '/request/req-1?card=c1' }, 'approve'))).toBeNull();
    expect(extractPushPath(makeResponse('n6', { path: '/unknown/route' }))).toBeNull();
    expect(extractPushPath(makeResponse('n7', null))).toBeNull();
  });
});

describe('initPushOpen', () => {
  beforeEach(() => {
    resetPushOpenForTest();
  });

  it('navigates on cold start from lastNotificationResponse and on background tap', async () => {
    let listener: ((r: NotificationResponseLike) => void) | undefined;
    const remove = vi.fn();
    const navigate = vi.fn();

    const coldResponse = makeResponse('cold-1', { path: '/request/req-10?card=c-10' });
    const bgResponse = makeResponse('bg-1', { path: '/request/req-20?card=c-20' });

    const notifications: NotificationsOpenApi = {
      DEFAULT_ACTION_IDENTIFIER: 'expo.modules.notifications.actions.DEFAULT',
      getLastNotificationResponseAsync: vi.fn(async () => coldResponse),
      addNotificationResponseReceivedListener: vi.fn((cb) => {
        listener = cb;
        return { remove };
      }),
    };

    const stop = initPushOpen({ notifications, navigate });
    await Promise.resolve();
    await Promise.resolve();

    expect(navigate).toHaveBeenCalledTimes(1);
    expect(navigate).toHaveBeenNthCalledWith(1, '/request/req-10?card=c-10');

    listener?.(bgResponse);
    expect(navigate).toHaveBeenCalledTimes(2);
    expect(navigate).toHaveBeenNthCalledWith(2, '/request/req-20?card=c-20');

    // Duplicate response with the same identifier is not navigated twice.
    listener?.(coldResponse);
    expect(navigate).toHaveBeenCalledTimes(2);

    stop();
    expect(remove).toHaveBeenCalledTimes(1);
  });

  it('does not navigate after cleanup even if cold-start promise resolves late', async () => {
    let resolveCold!: (r: NotificationResponseLike | null) => void;
    const navigate = vi.fn();

    const notifications: NotificationsOpenApi = {
      getLastNotificationResponseAsync: () =>
        new Promise((resolve) => {
          resolveCold = resolve;
        }),
      addNotificationResponseReceivedListener: () => ({ remove: vi.fn() }),
    };

    const stop = initPushOpen({ notifications, navigate });
    stop();
    resolveCold(makeResponse('late-1', { path: '/request/req-1?card=c-1' }));
    await Promise.resolve();
    await Promise.resolve();

    expect(navigate).not.toHaveBeenCalled();
  });

  it('queues cold-start notification tap when logged out and navigates with ?card= after login', async () => {
    let authenticated = false;
    let authListener: (() => void) | undefined;
    const navigate = vi.fn();

    const notifications: NotificationsOpenApi = {
      DEFAULT_ACTION_IDENTIFIER: 'expo.modules.notifications.actions.DEFAULT',
      getLastNotificationResponseAsync: vi.fn(async () =>
        makeResponse('cold-auth-1', { path: '/request/req-77?card=card-99' }),
      ),
      addNotificationResponseReceivedListener: () => ({ remove: vi.fn() }),
    };

    const stop = initPushOpen({
      notifications,
      navigate,
      isAuthenticated: () => authenticated,
      subscribeAuth: (cb) => {
        authListener = cb;
        return vi.fn();
      },
    });

    await vi.waitFor(() =>
      expect(notifications.getLastNotificationResponseAsync).toHaveBeenCalledTimes(1),
    );
    await Promise.resolve();
    expect(navigate).not.toHaveBeenCalled();

    authenticated = true;
    authListener?.();
    expect(navigate).toHaveBeenCalledTimes(1);
    expect(navigate).toHaveBeenCalledWith('/request/req-77?card=card-99');

    stop();
  });

  it('survives /login redirect remount when logged out on /login, lands on home, and navigates once', async () => {
    let token: string | null = null;
    let pathname = '/login';
    let authListener: (() => void) | undefined;
    const navigate = vi.fn();
    const canOpen = () => Boolean(token) && pathname !== '/login';

    const coldResponse = makeResponse('cold-login-redirect', { path: '/request/req-204?card=card-204' });
    const notifications: NotificationsOpenApi = {
      DEFAULT_ACTION_IDENTIFIER: 'expo.modules.notifications.actions.DEFAULT',
      getLastNotificationResponseAsync: vi.fn(async () => coldResponse),
      addNotificationResponseReceivedListener: () => ({ remove: vi.fn() }),
    };

    // 1. Logged out on /login: cold-start notification is captured but not navigated or marked handled.
    const stop1 = initPushOpen({
      notifications,
      navigate,
      isAuthenticated: canOpen,
      subscribeAuth: (cb) => {
        authListener = cb;
        return vi.fn();
      },
    });
    await vi.waitFor(() => expect(notifications.getLastNotificationResponseAsync).toHaveBeenCalledTimes(1));
    await Promise.resolve();
    expect(navigate).not.toHaveBeenCalled();

    // 2. Login triggers /login Redirect (still pathname === '/login', or even an unmount/remount frame).
    token = 'sess-204';
    authListener?.();
    expect(navigate).not.toHaveBeenCalled();
    stop1();

    // 3. Lands on home ('/') -> remounted or updated listener flushes pending target and navigates once.
    pathname = '/';
    const stop2 = initPushOpen({
      notifications,
      navigate,
      isAuthenticated: canOpen,
      subscribeAuth: (cb) => {
        authListener = cb;
        return vi.fn();
      },
    });
    await vi.waitFor(() => expect(navigate).toHaveBeenCalledTimes(1));
    expect(navigate).toHaveBeenCalledWith('/request/req-204?card=card-204');

    // Same notification will not navigate a second time.
    authListener?.();
    expect(navigate).toHaveBeenCalledTimes(1);
    stop2();
  });
});
