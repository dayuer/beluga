import { useCallback, useEffect, useState } from 'react';
import { cache } from './cache';
import { hub, isDemoMode } from './client';
import { DEMO_SCREENS } from './demo';
import type { ProjectSummary } from './hub-schema';
import { kv } from './kv';
import { useOnline } from './net';
import { session } from './session';
import type { SettingsView } from './views';

export type P9DemoKey = keyof typeof DEMO_SCREENS.P9;

export const SETTINGS_CACHE_KEY = 'settings:view';

export function buildRealSettingsView({
  customerId,
  projects,
  pushEnabled,
  appearance,
}: {
  readonly customerId?: string;
  readonly projects: readonly ProjectSummary[];
  readonly pushEnabled?: boolean;
  readonly appearance?: 'light' | 'dark' | 'system';
}): SettingsView {
  return {
    projects: projects.map((p) => ({
      id: p.id,
      name: p.name,
      platform: 'web',
      runMode: 'every-step',
      prodEnabled: false,
    })),
    envs: {},
    forges: [],
    runners: [],
    devices: [],
    account: {
      email: customerId ?? '',
      pushEnabled: pushEnabled ?? true,
      appearance: appearance ?? 'system',
    },
  };
}

export function resolveDemoSettings(demoKey: P9DemoKey = 'normal'): {
  readonly data: SettingsView;
  readonly loading: boolean;
  readonly offline: boolean;
} {
  const fixture = DEMO_SCREENS.P9[demoKey] ?? DEMO_SCREENS.P9.normal;
  return {
    data: fixture.data,
    loading: Boolean('loading' in fixture && fixture.loading),
    offline: Boolean('offline' in fixture && fixture.offline),
  };
}

export function useSettingsView(demoKey: P9DemoKey = 'normal'): {
  readonly data: SettingsView;
  readonly loading: boolean;
  readonly offline: boolean;
  readonly error: boolean;
  readonly refresh: () => Promise<void>;
} {
  const demoMode = isDemoMode();
  const online = useOnline();

  const [data, setData] = useState<SettingsView>(() => {
    if (demoMode) return resolveDemoSettings(demoKey).data;
    const cached = cache.get<SettingsView>(SETTINGS_CACHE_KEY);
    if (cached) return cached.value;
    return buildRealSettingsView({
      customerId: session.get()?.customerId,
      projects: cache.get<ProjectSummary[]>('projects')?.value ?? [],
      pushEnabled: kv.get<boolean>('prefs:pushEnabled'),
      appearance: kv.get<'light' | 'dark' | 'system'>('prefs:appearance'),
    });
  });

  const [loading, setLoading] = useState<boolean>(() => {
    if (demoMode) return resolveDemoSettings(demoKey).loading;
    return cache.get<SettingsView>(SETTINGS_CACHE_KEY) === undefined;
  });

  const [error, setError] = useState(false);

  const refresh = useCallback(async () => {
    if (demoMode) {
      const demo = resolveDemoSettings(demoKey);
      setData(demo.data);
      setLoading(demo.loading);
      setError(false);
      return;
    }

    const cached = cache.get<SettingsView>(SETTINGS_CACHE_KEY);
    if (!cached) setLoading(true);

    const res = await hub.projects();
    if (!res.ok) {
      if (res.error.kind === 'signed-out') {
        session.clear();
      }
      setError(!cached);
      setLoading(false);
      return;
    }

    const next = buildRealSettingsView({
      customerId: session.get()?.customerId,
      projects: res.value.projects,
      pushEnabled: kv.get<boolean>('prefs:pushEnabled'),
      appearance: kv.get<'light' | 'dark' | 'system'>('prefs:appearance'),
    });
    cache.set(SETTINGS_CACHE_KEY, next, Date.now());
    setData(next);
    setError(false);
    setLoading(false);
  }, [demoKey, demoMode]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const demoOffline = demoMode ? resolveDemoSettings(demoKey).offline : false;
  return {
    data,
    loading,
    offline: !online || demoOffline,
    error,
    refresh,
  };
}
