import { describe, expect, it, vi } from 'vitest';

vi.mock('./kv', () => ({ kv: { get: () => undefined, set: () => {}, remove: () => {} } }));
vi.mock('./cache', () => ({ cache: { get: () => undefined, set: () => {} } }));
vi.mock('./session', () => ({ session: { clear: () => {}, get: () => undefined, token: () => undefined } }));
vi.mock('./client', () => ({ isDemoMode: () => false, hub: { projects: async () => ({ ok: true, value: { projects: [] } }) } }));
vi.mock('./net', () => ({ useOnline: () => true }));

import { buildRealSettingsView, resolveDemoSettings } from './settings-source';

describe('lib/settings-source', () => {
  it('returns DEMO_SCREENS.P9 fixtures in demo mode', () => {
    const normal = resolveDemoSettings('normal');
    expect(normal.loading).toBe(false);
    expect(normal.offline).toBe(false);
    expect(normal.data.projects.length).toBeGreaterThan(0);

    const empty = resolveDemoSettings('empty');
    expect(empty.data.projects).toEqual([]);
    expect(empty.data.devices).toEqual([]);

    const loading = resolveDemoSettings('loading');
    expect(loading.loading).toBe(true);

    const offline = resolveDemoSettings('offline');
    expect(offline.offline).toBe(true);

    const runnerOff = resolveDemoSettings('runnerOffline');
    expect(runnerOff.data.runners.every((r) => !r.online)).toBe(true);
  });

  it('builds real settings view from session & hub projects without demo data', () => {
    const real = buildRealSettingsView({
      customerId: 'cust-real-1',
      projects: [{ id: 'p-1', studioId: 's-1', studioName: 'Studio', name: 'My App' }],
      pushEnabled: false,
      appearance: 'dark',
    });

    expect(real.account.email).toBe('cust-real-1');
    expect(real.account.pushEnabled).toBe(false);
    expect(real.account.appearance).toBe('dark');
    expect(real.projects).toHaveLength(1);
    expect(real.projects[0]?.name).toBe('My App');
    expect(real.envs).toEqual({});
    expect(real.runners).toEqual([]);
    expect(real.devices).toEqual([]);
  });
});
