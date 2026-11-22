import React from 'react';
import { fireEvent, render, within } from '@testing-library/react-native';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SettingsView } from '../lib/views';

const h = vi.hoisted(() => ({
  hasKey: true,
  error: null as string | null,
  sends: [] as unknown[],
}));

const settings: SettingsView = {
  projects: [
    { id: 'p1', name: '项目一', platform: 'ios', runMode: 'auto-delivery', prodEnabled: true },
    { id: 'p2', name: '项目二', platform: 'web', runMode: 'every-step', prodEnabled: false },
  ],
  envs: {},
  forges: [{ projectId: 'p1', mode: 'repo', hasToken: false }],
  runners: [],
  devices: [],
  account: { email: 'a@b.c', pushEnabled: true, appearance: 'system' },
};

vi.mock('expo-localization', () => ({ getLocales: () => [{ languageCode: 'zh' }] }));
vi.mock('expo-crypto', () => ({ getRandomBytes: (n: number) => new Uint8Array(n).fill(7) }));
vi.mock('../lib/viewport', () => ({ useKeyboardInset: () => 0 }));
vi.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));
vi.mock('./Header', () => ({ Header: () => null }));
vi.mock('./Skeleton', () => ({ Skeleton: () => null }));
vi.mock('../lib/kv', () => ({ kv: { get: () => undefined, set: () => {}, remove: () => {} } }));
vi.mock('../lib/secure', () => ({ secure: { get: async () => undefined, set: async () => {}, remove: async () => {} } }));
vi.mock('../lib/keys', () => ({
  useHasDeviceKey: () => ({ ready: true, hasKey: h.hasKey }),
  publicKey: async () => null,
  sealPublicKey: async () => null,
  ensureDeviceKey: async () => new Uint8Array(32),
  sign: async () => new Uint8Array(64),
  clearDeviceKey: async () => {},
  DeviceKeyMissingError: class DeviceKeyMissingError extends Error {},
}));
vi.mock('../lib/use-signed-action', () => ({
  useSignedAction: () => ({
    buttonState: 'idle',
    error: h.error,
    send: async (build: (opId: string) => unknown, handlers?: { onDone?: () => void }) => {
      h.sends.push(build('op-1'));
      handlers?.onDone?.();
    },
    retry: vi.fn(),
    reset: vi.fn(),
  }),
}));
vi.mock('../lib/settings-source', () => ({
  useSettingsView: () => ({ data: settings, loading: false, offline: false, error: false, refresh: vi.fn() }),
}));

import MeProjectScreen from '../app/me/project';
import { resetDrawerCount } from '../lib/ui-state';

async function openSheet(screen: Awaited<ReturnType<typeof render>>, pid: string) {
  await fireEvent.press(screen.getByTestId(`project-settings-${pid}`));
}

describe('SS-228 phone project settings', () => {
  beforeEach(() => {
    h.hasKey = true;
    h.error = null;
    h.sends = [];
    delete process.env.EXPO_PUBLIC_PHONE_SETTINGS;
  });
  afterEach(() => {
    resetDrawerCount();
    delete process.env.EXPO_PUBLIC_PHONE_SETTINGS;
  });

  it('changes the delivery mode, confirms, and sends a signed settings.update', async () => {
    const screen = await render(<MeProjectScreen />);
    await openSheet(screen, 'p1');

    await fireEvent.press(screen.getByTestId('project-settings-sheet-mode-push-mine'));
    await fireEvent.changeText(screen.getByTestId('project-settings-sheet-repo'), 'https://github.com/me/app');
    await fireEvent.press(screen.getByTestId('project-settings-sheet-ask'));

    // 二次确认：主按钮写「保存设置」。
    const confirm = screen.getByTestId('project-settings-sheet-confirm');
    expect(within(confirm).getAllByText('保存设置').length).toBeGreaterThan(0);
    await fireEvent.press(screen.getByTestId('project-settings-sheet-confirm-confirm'));

    expect(h.sends).toHaveLength(1);
    expect((h.sends[0] as { kind: string }).kind).toBe('settings.update');
    expect((h.sends[0] as { payload: unknown }).payload).toEqual({
      projectId: 'p1',
      settings: { delivery: 'repo', repoUrl: 'https://github.com/me/app' },
    });

    // 成功后抽屉关闭，卡片先换成新的交付方式与仓库地址。
    expect(screen.queryByTestId('project-settings-sheet')).toBeNull();
    expect(screen.getByText('推送到我的仓库')).toBeTruthy();
    expect(screen.getByText('https://github.com/me/app')).toBeTruthy();
  });

  it('shows the refusal reason and keeps the sheet open', async () => {
    h.error = '这台设备还没登记，先在「设备」里配对';
    const screen = await render(<MeProjectScreen />);
    await openSheet(screen, 'p1');
    await fireEvent.press(screen.getByTestId('project-settings-sheet-mode-preview-only'));
    await fireEvent.press(screen.getByTestId('project-settings-sheet-ask'));

    expect(screen.getByText('这台设备还没登记，先在「设备」里配对')).toBeTruthy();
    expect(screen.getByTestId('project-settings-sheet')).toBeTruthy();
  });

  it('will not send a push-mine setting without an https URL', async () => {
    const screen = await render(<MeProjectScreen />);
    await openSheet(screen, 'p1');
    await fireEvent.press(screen.getByTestId('project-settings-sheet-mode-push-mine'));
    await fireEvent.changeText(screen.getByTestId('project-settings-sheet-repo'), 'http://insecure.example');

    expect(screen.getByTestId('project-settings-sheet-ask').props.accessibilityState.disabled).toBe(true);
    expect(screen.getAllByText('选「推送到我的仓库」时，要填一个 https 仓库地址').length).toBeGreaterThan(0);
  });

  it('hides the entry when the switch is off', async () => {
    process.env.EXPO_PUBLIC_PHONE_SETTINGS = '0';
    const screen = await render(<MeProjectScreen />);
    expect(screen.queryByTestId('project-settings-p1')).toBeNull();
    expect(screen.queryByTestId('project-settings-p2')).toBeNull();
    expect(screen.getByText('填和换在桌面上做')).toBeTruthy();
  });
});
