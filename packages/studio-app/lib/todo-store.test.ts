import { beforeEach, describe, expect, it, vi } from 'vitest';

const { setBadgeCountAsync, projectsMock, plansMock, planMock } = vi.hoisted(() => ({
  setBadgeCountAsync: vi.fn(async () => true),
  projectsMock: vi.fn(),
  plansMock: vi.fn(),
  planMock: vi.fn(),
}));

vi.mock('expo-notifications', () => ({
  setBadgeCountAsync,
}));

vi.mock('react-native', () => ({
  Platform: { OS: 'ios' },
  AppState: { currentState: 'active', addEventListener: vi.fn(() => ({ remove: vi.fn() })) },
}));

vi.mock('./cache', () => ({
  cache: {
    get: vi.fn(() => undefined),
    set: vi.fn(),
    remove: vi.fn(),
  },
}));

vi.mock('./client', () => ({
  hub: {
    projects: projectsMock,
    plans: plansMock,
    plan: planMock,
  },
}));

vi.mock('./session', () => ({
  session: {
    snapshot: () => 'tok-1',
    subscribe: () => () => {},
  },
}));

vi.mock('./strings', () => ({
  detectLang: () => 'zh',
}));

import { getBadgeCount, initBadgeSync, resetBadgeForTest } from './badge';
import { fetchTodos, markTodoHandled, resetTodoStoreForTest, subscribeTodos } from './todo-store';

function makePlanView(decisionIds: string[]) {
  return {
    planRef: 'plan-1',
    draftRev: 1,
    title: 'Test Plan',
    goal: 'Goal',
    stage: 'running',
    waitingOn: 'customer',
    headline: 'Waiting',
    progress: { done: 0, total: 1 },
    milestones: [],
    decisions: decisionIds.map((id) => ({
      decisionId: id,
      question: `Q ${id}`,
      options: [{ id: 'o1', label: 'Yes' }],
      multi: false,
      open: true,
    })),
    turns: [],
    typing: false,
    moreTurns: false,
    activity: [],
  };
}

describe('todo-store + badge integration (SS-164)', () => {
  beforeEach(() => {
    resetTodoStoreForTest();
    resetBadgeForTest();
    setBadgeCountAsync.mockClear();
  });

  it('sets badge to N, drops immediately to N-1 on markTodoHandled, and matches server on next refresh', async () => {
    projectsMock.mockResolvedValue({ ok: true, value: { projects: [{ id: 'p1', name: 'Proj 1' }] } });
    plansMock.mockResolvedValue({
      ok: true,
      value: { plans: [{ planRef: 'plan-1', title: 'Test Plan', stage: 'running', updatedAt: 100 }] },
    });
    planMock.mockResolvedValue({ ok: true, value: { view: makePlanView(['d1', 'd2', 'd3']) } });

    const seenCounts: number[] = [];
    const unsub = subscribeTodos((res) => seenCounts.push(res.todos.length));

    const stopBadge = initBadgeSync({
      notifications: { setBadgeCountAsync },
      getToken: () => 'tok-1',
    });

    await vi.waitFor(() => expect(setBadgeCountAsync).toHaveBeenLastCalledWith(3));
    expect(getBadgeCount()).toBe(3);

    // Handle one item locally: badge immediately drops to 2 (N - 1) without waiting for network.
    const next = markTodoHandled('decision:plan-1:d2');
    expect(next?.todos).toHaveLength(2);
    await vi.waitFor(() => expect(setBadgeCountAsync).toHaveBeenLastCalledWith(2));
    expect(getBadgeCount()).toBe(2);

    // Next server refresh returns 1 remaining item: badge matches server (1).
    planMock.mockResolvedValue({ ok: true, value: { view: makePlanView(['d3']) } });
    await fetchTodos(true);
    await vi.waitFor(() => expect(setBadgeCountAsync).toHaveBeenLastCalledWith(1));
    expect(getBadgeCount()).toBe(1);
    expect(seenCounts).toEqual([3, 2, 1]);

    unsub();
    stopBadge();
  });
});
