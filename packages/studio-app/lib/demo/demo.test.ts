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

import { parseCard, parseRequestSummary, parseRequestView, parseSettingsView } from '../views';
import { DEMO_SCREENS } from './screens';

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

    // P2: RequestSummary[]
    for (const s of stateKeys) {
      for (const item of DEMO_SCREENS.P2[s].data) {
        expect(parseRequestSummary(item)).not.toBeNull();
      }
    }

    // P4–P8: RequestView
    for (const screen of ['P4', 'P5', 'P6', 'P7', 'P8'] as const) {
      for (const s of stateKeys) {
        const parsed = parseRequestView(DEMO_SCREENS[screen][s].data);
        expect(parsed).not.toBeNull();
      }
    }

    // P10: Todo cards
    for (const s of stateKeys) {
      for (const c of [...DEMO_SCREENS.P10[s].data.needsYou, ...DEMO_SCREENS.P10[s].data.waiting]) {
        expect(parseCard(c).kind).not.toBe('unknown');
      }
    }

    // P11: SettingsView
    for (const s of stateKeys) {
      expect(parseSettingsView(DEMO_SCREENS.P11[s].data)).not.toBeNull();
    }
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
});
