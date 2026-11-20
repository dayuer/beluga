import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('expo-notifications', () => ({
  setBadgeCountAsync: vi.fn(async () => true),
}));

vi.mock('react-native', () => ({
  Platform: { OS: 'ios' },
  AppState: { currentState: 'active', addEventListener: vi.fn(() => ({ remove: vi.fn() })) },
}));

vi.mock('./session', () => ({
  session: {
    snapshot: () => null,
    subscribe: () => () => {},
  },
}));

vi.mock('./todo-store', () => ({
  fetchTodos: vi.fn(async () => ({ todos: [], byProject: {}, fetchedAt: 0, failed: 0 })),
}));

import {
  decrementBadge,
  getBadgeCount,
  initBadgeSync,
  resetBadgeForTest,
  setBadgeCount,
  syncBadge,
  type BadgeDeps,
} from './badge';
import type { TodosResult } from './todo-store';

function makeTodos(count: number): TodosResult {
  return {
    todos: Array.from({ length: count }, (_, i) => ({
      pid: 'p1',
      planRef: 'r1',
      kind: 'decision' as const,
      title: `Todo ${i}`,
      sub: 'Waiting on your decision',
      key: `p1:r1:decision:c-${i}`,
      decisionId: `c-${i}`,
      projectName: 'Demo',
      updatedAt: 1000,
    })),
    byProject: { p1: count },
    fetchedAt: 1000,
    failed: 0,
  };
}

describe('badge', () => {
  beforeEach(() => {
    resetBadgeForTest();
  });

  it('sets badge to todo count and decrements by 1 when a card is handled', async () => {
    const setBadgeCountAsync = vi.fn(async () => true);
    const fetchTodos = vi.fn(async () => makeTodos(3));
    const deps: BadgeDeps = {
      notifications: { setBadgeCountAsync },
      fetchTodos,
      getToken: () => 'tok-1',
    };

    const count = await syncBadge(false, deps);
    expect(count).toBe(3);
    expect(getBadgeCount()).toBe(3);
    expect(setBadgeCountAsync).toHaveBeenLastCalledWith(3);

    const after = await decrementBadge(1, deps);
    expect(after).toBe(2);
    expect(getBadgeCount()).toBe(2);
    expect(setBadgeCountAsync).toHaveBeenLastCalledWith(2);

    // Clamps at 0.
    await setBadgeCount(0, deps);
    await decrementBadge(1, deps);
    expect(getBadgeCount()).toBe(0);
    expect(setBadgeCountAsync).toHaveBeenLastCalledWith(0);
  });

  it('syncs on foreground resume and clears badge on logout', async () => {
    const setBadgeCountAsync = vi.fn(async () => true);
    let token: string | null = 'tok-1';
    let todoCount = 2;
    let resumeCb: (() => void) | undefined;
    let sessionCb: (() => void) | undefined;

    const deps: BadgeDeps = {
      notifications: { setBadgeCountAsync },
      fetchTodos: vi.fn(async () => makeTodos(todoCount)),
      getToken: () => token,
      subscribeResume: (cb) => {
        resumeCb = cb;
        return vi.fn();
      },
      subscribeSession: (cb) => {
        sessionCb = cb;
        return vi.fn();
      },
    };

    const stop = initBadgeSync(deps);
    await Promise.resolve();
    await Promise.resolve();
    expect(setBadgeCountAsync).toHaveBeenLastCalledWith(2);

    // App returns to foreground with updated todo count.
    todoCount = 4;
    resumeCb?.();
    await Promise.resolve();
    await Promise.resolve();
    expect(setBadgeCountAsync).toHaveBeenLastCalledWith(4);

    // User logs out -> badge resets to 0.
    token = null;
    sessionCb?.();
    await Promise.resolve();
    expect(setBadgeCountAsync).toHaveBeenLastCalledWith(0);

    stop();
  });
});
