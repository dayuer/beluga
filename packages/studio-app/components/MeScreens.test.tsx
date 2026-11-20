import { render } from '@testing-library/react-native';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SettingsView } from '../lib/views';

const mockSettings = {
  data: {
    projects: [],
    envs: {},
    forges: [],
    runners: [],
    devices: [],
    account: { email: '', pushEnabled: true, appearance: 'system' as const },
  } satisfies SettingsView,
  loading: false,
  offline: false,
  error: false,
};

vi.mock('lucide-react-native', () => ({
  ChevronRight: () => null,
}));
vi.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));
vi.mock('./Header', () => ({ Header: () => null }));
vi.mock('./Skeleton', () => ({ Skeleton: () => null }));
vi.mock('./ConfirmSheet', () => ({ ConfirmSheet: () => null }));
vi.mock('./SignedButton', () => ({ SignedButton: () => null }));
vi.mock('expo-router', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn() }),
}));
vi.mock('expo-localization', () => ({
  getLocales: () => [{ languageCode: 'zh' }],
}));
vi.mock('expo-haptics', () => ({
  impactAsync: vi.fn(),
  notificationAsync: vi.fn(),
  selectionAsync: vi.fn(),
  ImpactFeedbackStyle: { Light: 'light', Medium: 'medium', Heavy: 'heavy' },
  NotificationFeedbackType: { Success: 'success', Warning: 'warning', Error: 'error' },
}));
vi.mock('../lib/kv', () => ({
  kv: { get: () => undefined, set: () => {}, remove: () => {} },
}));
vi.mock('../lib/cache', () => ({
  cache: { get: () => undefined, set: () => {} },
}));
vi.mock('../lib/session', () => ({
  session: { clear: vi.fn(), get: () => undefined, token: () => undefined },
}));
vi.mock('../lib/keys', () => ({
  useHasDeviceKey: () => ({ ready: true, hasKey: false }),
}));
vi.mock('../lib/todo-store', () => ({
  useTodos: () => ({ result: undefined, loading: false, error: null, refresh: vi.fn() }),
}));
vi.mock('../lib/client', () => ({
  isDemoMode: () => false,
  hub: { projects: vi.fn(async () => ({ ok: true, value: { projects: [] } })) },
}));
vi.mock('../lib/settings-source', () => ({
  useSettingsView: () => ({ ...mockSettings, refresh: vi.fn(async () => {}) }),
}));

import MeScreen from '../app/(tabs)/me';
import MeAccountScreen from '../app/me/account';
import MeDevicesScreen from '../app/me/devices';
import MeEnvScreen from '../app/me/env';
import MeMachinesScreen from '../app/me/machines';
import MeProjectScreen from '../app/me/project';

describe('Me & sub-screens loading, offline, and empty states', () => {
  beforeEach(() => {
    mockSettings.loading = false;
    mockSettings.offline = false;
    mockSettings.data = {
      projects: [],
      envs: {},
      forges: [],
      runners: [],
      devices: [],
      account: { email: '', pushEnabled: true, appearance: 'system' },
    };
  });

  it('shows offline banner and loading skeleton on all 6 screens', async () => {
    mockSettings.offline = true;
    mockSettings.loading = true;

    const screens = [
      { el: <MeScreen />, skel: 'me-skeleton' },
      { el: <MeEnvScreen />, skel: 'env-skeleton' },
      { el: <MeMachinesScreen />, skel: 'machines-skeleton' },
      { el: <MeProjectScreen />, skel: 'project-skeleton' },
      { el: <MeDevicesScreen />, skel: 'devices-skeleton' },
      { el: <MeAccountScreen />, skel: 'account-skeleton' },
    ];

    for (const { el, skel } of screens) {
      const { getByTestId } = await render(el);
      expect(getByTestId('offline-banner')).toBeTruthy();
      expect(getByTestId(skel)).toBeTruthy();
    }
  });

  it('shows empty states on list screens (env, machines, project, devices)', async () => {
    const emptyScreens = [
      { el: <MeEnvScreen />, emptyId: 'env-empty' },
      { el: <MeMachinesScreen />, emptyId: 'machines-empty' },
      { el: <MeProjectScreen />, emptyId: 'project-empty' },
      { el: <MeDevicesScreen />, emptyId: 'devices-empty' },
    ];

    for (const { el, emptyId } of emptyScreens) {
      const { getByTestId } = await render(el);
      expect(getByTestId(emptyId)).toBeTruthy();
    }
  });
});
