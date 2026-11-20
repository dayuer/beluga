import { fireEvent, render } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SettingsView } from '../lib/views';

const mockRouter = { push: vi.fn(), replace: vi.fn(), back: vi.fn() };
const mockLogout = vi.fn(async () => ({ ok: true as const, value: undefined }));
const mockSessionClear = vi.fn();

const threeDevicesSettings: SettingsView = {
  projects: [],
  envs: {},
  forges: [],
  runners: [],
  devices: [
    { id: 'd1', name: 'iPhone', platform: 'ios', registeredAt: 1000, lastSeenAt: 1000, isCurrent: true },
    { id: 'd2', name: 'iPad', platform: 'ios', registeredAt: 1000, lastSeenAt: 1000 },
    { id: 'd3', name: 'Mac', platform: 'mac', registeredAt: 1000, lastSeenAt: 1000 },
  ],
  account: { email: 'u@example.com', pushEnabled: true, appearance: 'system' },
};

vi.mock('react-native', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-native')>();
  return { ...actual, Switch: 'Switch' };
});

vi.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));
vi.mock('lucide-react-native', () => ({ ChevronRight: () => null }));
vi.mock('./Header', () => ({ Header: () => null }));
vi.mock('./Skeleton', () => ({ Skeleton: () => null }));
vi.mock('./ConfirmSheet', () => ({
  ConfirmSheet: ({
    open,
    confirmLabel,
    onConfirm,
    testID,
  }: {
    open: boolean;
    confirmLabel: string;
    onConfirm: () => void;
    testID?: string;
  }) => {
    if (!open) return null;
    const { Pressable, Text } = require('react-native');
    return (
      <Pressable testID={`${testID}-btn`} onPress={onConfirm}>
        <Text>{confirmLabel}</Text>
      </Pressable>
    );
  },
}));
vi.mock('expo-router', () => ({ useRouter: () => mockRouter }));
vi.mock('expo-localization', () => ({ getLocales: () => [{ languageCode: 'zh' }] }));
vi.mock('../lib/kv', () => ({ kv: { get: () => undefined, set: () => {}, remove: () => {} } }));
vi.mock('../lib/session', () => ({
  session: { clear: () => mockSessionClear(), get: () => undefined, token: () => undefined },
}));
vi.mock('../lib/keys', () => ({ useHasDeviceKey: () => ({ ready: true, hasKey: false }) }));
vi.mock('../lib/client', () => ({
  isDemoMode: () => false,
  hub: { logout: () => mockLogout() },
}));
vi.mock('../lib/settings-source', () => ({
  useSettingsView: () => ({
    data: threeDevicesSettings,
    loading: false,
    offline: false,
    error: false,
    refresh: vi.fn(),
  }),
}));

import MeAccountScreen from '../app/me/account';
import MeDevicesScreen from '../app/me/devices';
import { zh as meZh } from '../lib/strings/me';

describe('Devices and Account screens (SS-200)', () => {
  beforeEach(() => {
    mockLogout.mockClear();
    mockSessionClear.mockClear();
    mockRouter.replace.mockClear();
  });

  it('uses text buttons on device rows (at most 1 solid button on ConfirmSheet) and action labels in me.ts', async () => {
    expect(meZh['devices.removeConfirm']).toBe('移除设备');
    expect(meZh['account.deleteConfirm']).toBe('删除账号');

    const { getByTestId, queryAllByTestId } = await render(<MeDevicesScreen />);
    expect(queryAllByTestId(/^signed-button/)).toHaveLength(0);
    const removeBtn = getByTestId('device-remove-d2');
    const style = StyleSheet.flatten(removeBtn.props.style);
    expect(style.backgroundColor).toBeUndefined();
  });

  it('calls hub.logout + session.clear on sign out, keeps delete account separate and disabled, and 44pt language chips', async () => {
    const { getByTestId } = await render(<MeAccountScreen />);

    const zhStyle = StyleSheet.flatten(getByTestId('account-lang-zh').props.style);
    expect(zhStyle.minHeight).toBeGreaterThanOrEqual(44);

    const deleteBtn = getByTestId('account-delete');
    expect(deleteBtn.props.disabled).toBe(true);
    expect(getByTestId('account-delete-note')).toBeTruthy();

    await fireEvent.press(getByTestId('account-logout'));
    await fireEvent.press(getByTestId('account-logout-confirm-btn'));

    expect(mockLogout).toHaveBeenCalledTimes(1);
    expect(mockSessionClear).toHaveBeenCalledTimes(1);
    expect(mockRouter.replace).toHaveBeenCalledWith('/login');
  });
});
