import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('react-native', () => ({
  AppState: { addEventListener: vi.fn(() => ({ remove: vi.fn() })) },
  Platform: { OS: 'ios', select: (m: Record<string, unknown>) => m.ios ?? m.default },
}));

vi.mock('expo-secure-store', () => ({
  getItemAsync: vi.fn(async () => null),
  setItemAsync: vi.fn(async () => {}),
  deleteItemAsync: vi.fn(async () => {}),
}));

import {
  CodeCardSchema,
  parseCard,
  parseLoginView,
  parseNewRequestView,
  parseReasonSheetView,
  parseRequestSummary,
  parseRequestView,
  parseResultDrawerView,
  parseSettingsView,
  parseTodoScreenView,
} from '../views';
import { DEMO_CARDS, DEMO_SCREENS } from './screens';

describe('demo fixtures (P1–P12)', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it('covers all 5 states for every screen P1–P12 and passes views parsers', () => {
    const screenKeys = ['P1', 'P2', 'P3', 'P4', 'P5', 'P6', 'P7', 'P8', 'P9', 'P10', 'P11', 'P12'] as const;
    const stateKeys = ['normal', 'empty', 'loading', 'offline', 'runnerOffline'] as const;

    for (const screen of screenKeys) {
      for (const state of stateKeys) {
        expect(DEMO_SCREENS[screen][state].state).toBe(state);
      }
    }

    // P1: 登录
    for (const s of stateKeys) {
      expect(parseLoginView(DEMO_SCREENS.P1[s].data)).not.toBeNull();
    }

    // P2: 提需求
    for (const s of stateKeys) {
      expect(parseNewRequestView(DEMO_SCREENS.P2[s].data)).not.toBeNull();
    }

    // P3, P4, P5, P6, P10, P11: RequestView
    for (const screen of ['P3', 'P4', 'P5', 'P6', 'P10', 'P11'] as const) {
      for (const s of stateKeys) {
        const parsed = parseRequestView(DEMO_SCREENS[screen][s].data);
        expect(parsed).not.toBeNull();
      }
    }

    // P7: 原因抽屉
    for (const s of stateKeys) {
      expect(parseReasonSheetView(DEMO_SCREENS.P7[s].data)).not.toBeNull();
    }

    // P8: 待办
    for (const s of stateKeys) {
      const parsed = parseTodoScreenView(DEMO_SCREENS.P8[s].data);
      expect(parsed).not.toBeNull();
      for (const c of [...(parsed?.needsYou ?? []), ...(parsed?.waiting ?? [])]) {
        expect(parseCard(c).kind).not.toBe('unknown');
      }
    }

    // P9: 「我」和子页
    for (const s of stateKeys) {
      expect(parseSettingsView(DEMO_SCREENS.P9[s].data)).not.toBeNull();
    }

    // P12: 结果抽屉
    for (const s of stateKeys) {
      expect(parseResultDrawerView(DEMO_SCREENS.P12[s].data)).not.toBeNull();
    }

    // requestsList: 跨项目需求列表
    for (const s of stateKeys) {
      for (const item of DEMO_SCREENS.requestsList[s].data) {
        expect(parseRequestSummary(item)).not.toBeNull();
      }
    }

    // CodeCardSchema 和代码卡假数据不包含分支名
    expect('branch' in CodeCardSchema.shape).toBe(false);
    expect('branch' in (DEMO_CARDS.code ?? {})).toBe(false);
  });

  it('issues zero network requests when EXPO_PUBLIC_DEMO=1', async () => {
    const fetchSpy = vi.fn(() => {
      throw new Error('fetch should not be called in DEMO mode');
    });
    const wsSpy = vi.fn(() => {
      throw new Error('WebSocket should not be called in DEMO mode');
    });
    vi.stubGlobal('fetch', fetchSpy);
    vi.stubGlobal('WebSocket', wsSpy);
    vi.stubEnv('EXPO_PUBLIC_DEMO', '1');
    vi.resetModules();

    const { hub, isDemoMode } = await import('../client');
    expect(isDemoMode()).toBe(true);

    const projectsRes = await hub.projects();
    expect(projectsRes.ok).toBe(true);
    await hub.plans('proj-shop');
    await hub.plan('proj-shop', 'req-login');
    await hub.turns('proj-shop', 'req-login');
    await hub.send('proj-shop', { t: 'action', opId: 'op-1', kind: 'chat.send', planRef: 'req-login', payload: { text: 'hi' } });
    const unwatch = hub.watch('proj-shop', { frame: () => {}, state: () => {} });
    unwatch();

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(wsSpy).not.toHaveBeenCalled();
  });

  it('does not call fetch on subscribeOnline and supports switching offline in DEMO mode', async () => {
    const fetchSpy = vi.fn(() => {
      throw new Error('fetch should not be called by net.ts in DEMO mode');
    });
    vi.stubGlobal('fetch', fetchSpy);
    vi.stubEnv('EXPO_PUBLIC_DEMO', '1');
    vi.resetModules();

    const { isOnline, refreshOnline, setDemoOnline, subscribeOnline } = await import('../net');
    const seen: boolean[] = [];
    const unsub = subscribeOnline((online) => seen.push(online));

    expect(isOnline()).toBe(true);
    await expect(refreshOnline()).resolves.toBe(true);
    expect(fetchSpy).not.toHaveBeenCalled();

    setDemoOnline(false);
    expect(isOnline()).toBe(false);
    expect(seen).toEqual([false]);

    setDemoOnline(true);
    expect(isOnline()).toBe(true);
    expect(seen).toEqual([false, true]);

    unsub();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('provides a demo session and all 4 todo kinds when EXPO_PUBLIC_DEMO=1', async () => {
    vi.stubEnv('EXPO_PUBLIC_DEMO', '1');
    vi.resetModules();

    const { session } = await import('../session');
    const { hub } = await import('../client');
    const { todosOf } = await import('../todo');

    expect(session.snapshot()).toBe('demo-session');

    const projectsRes = await hub.projects();
    expect(projectsRes.ok).toBe(true);
    if (!projectsRes.ok) return;

    const allTodos = [];
    for (const proj of projectsRes.value.projects) {
      const plansRes = await hub.plans(proj.id);
      if (!plansRes.ok) continue;
      for (const p of plansRes.value.plans) {
        const planRes = await hub.plan(proj.id, p.planRef);
        if (!planRes.ok) continue;
        allTodos.push(...todosOf(proj.id, planRes.value.view, 'zh'));
      }
    }

    expect(allTodos.length).toBeGreaterThanOrEqual(4);
    const kinds = new Set(allTodos.map((t) => t.kind));
    expect(kinds).toEqual(new Set(['decision', 'review', 'changes', 'confirm']));
  });

  it('does not inject a demo session when EXPO_PUBLIC_DEMO is unset', async () => {
    vi.stubEnv('EXPO_PUBLIC_DEMO', '');
    vi.resetModules();

    const { session } = await import('../session');
    expect(session.snapshot()).toBeNull();
  });
});
