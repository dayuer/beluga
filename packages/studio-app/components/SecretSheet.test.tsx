/// <reference types="node" />
import { generateKeyPairSync } from 'node:crypto';
import React from 'react';
import { fireEvent, render, within } from '@testing-library/react-native';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SettingsView } from '../lib/views';

const h = vi.hoisted(() => ({
  hasKey: true,
  error: null as string | null,
  sends: [] as unknown[],
  kvSets: [] as unknown[],
}));

const settings: SettingsView = {
  projects: [{ id: 'p1', name: '项目一', platform: 'ios', runMode: 'auto-delivery', prodEnabled: true }],
  envs: {
    p1: [
      {
        id: 'test',
        title: '测试',
        protected: false,
        target: { platform: 'ios', appId: 'com.p1', mode: 'TestFlight' },
        vars: [],
        secrets: [
          { name: 'P1_SECRET', purpose: 'P1 签名用途', at: Date.now() - 10 * 60_000, by: { name: '张三', via: 'studio' } },
          { name: 'NEVER_FILLED', purpose: '还没填过', at: 0, by: { name: '', via: 'studio' } },
        ],
      },
    ],
  },
  forges: [],
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
vi.mock('../lib/kv', () => ({
  kv: {
    get: () => undefined,
    set: (k: string, v: unknown) => {
      h.kvSets.push({ k, v });
    },
    remove: () => {},
  },
}));
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

import MeEnvScreen from '../app/me/env';
import { resetDrawerCount } from '../lib/ui-state';

/** 一把真实的 X25519 公钥（43 字符 base64url）：假的低阶点会被 noble 拒绝。 */
const SEAL_KEY = generateKeyPairSync('x25519').publicKey
  .export({ type: 'spki', format: 'der' })
  .subarray(-32)
  .toString('base64url');

async function openSheet(screen: Awaited<ReturnType<typeof render>>, name: string) {
  await fireEvent.press(screen.getByTestId(`env-secret-${name}`));
}

describe('SS-227 phone secret sheet', () => {
  beforeEach(() => {
    h.hasKey = true;
    h.error = null;
    h.sends = [];
    h.kvSets = [];
    delete process.env.EXPO_PUBLIC_PHONE_SETTINGS;
    process.env.EXPO_PUBLIC_NODE_SEAL_KEY = SEAL_KEY;
  });
  afterEach(() => {
    resetDrawerCount();
    delete process.env.EXPO_PUBLIC_PHONE_SETTINGS;
    delete process.env.EXPO_PUBLIC_NODE_SEAL_KEY;
  });

  it('fills a value, confirms, and sends a sealed secret.set with no plaintext anywhere', async () => {
    const screen = await render(<MeEnvScreen />);
    expect(screen.getByText('更新')).toBeTruthy();
    expect(screen.getByText('填写')).toBeTruthy();

    await openSheet(screen, 'P1_SECRET');
    const input = screen.getByTestId('secret-sheet-input');
    expect(input.props.secureTextEntry).toBe(true);
    expect(input.props.autoCorrect).toBe(false);

    await fireEvent.changeText(input, 'sk_live_should_not_leak');
    await fireEvent.press(screen.getByTestId('secret-sheet-ask'));

    // 二次确认：主按钮写「保存密钥」。
    const confirm = screen.getByTestId('secret-sheet-confirm');
    expect(within(confirm).getAllByText('保存密钥').length).toBeGreaterThan(0);
    await fireEvent.press(screen.getByTestId('secret-sheet-confirm-confirm'));

    expect(h.sends).toHaveLength(1);
    const action = h.sends[0] as { kind: string; payload: { name: string; sealed: unknown } };
    expect(action.kind).toBe('secret.set');
    expect(action.payload.name).toBe('P1_SECRET');
    expect(action.payload.sealed).toBeTruthy();

    // 明文不在这条帧里，也不在任何一次本地存储里。
    expect(JSON.stringify(action)).not.toContain('sk_live_should_not_leak');
    expect(JSON.stringify(h.kvSets)).not.toContain('sk_live_should_not_leak');

    // 成功后输入清空、抽屉关闭，列表上的更新时间换成本机保存的时刻。
    expect(screen.queryByTestId('secret-sheet-input')).toBeNull();
    expect(screen.getByTestId('env-time-P1_SECRET').props.children).toBe('刚刚');
  });

  it('shows the refusal reason and keeps the sheet open', async () => {
    h.error = '这台设备还没登记，先在「设备」里配对';
    const screen = await render(<MeEnvScreen />);
    await openSheet(screen, 'P1_SECRET');
    await fireEvent.changeText(screen.getByTestId('secret-sheet-input'), 'value-1');
    await fireEvent.press(screen.getByTestId('secret-sheet-ask'));

    expect(screen.getByText('这台设备还没登记，先在「设备」里配对')).toBeTruthy();
    expect(screen.getByTestId('secret-sheet-input')).toBeTruthy();
  });

  it('hides both entry points when the switch is off', async () => {
    process.env.EXPO_PUBLIC_PHONE_SETTINGS = '0';
    const screen = await render(<MeEnvScreen />);
    expect(screen.queryByTestId('env-secret-P1_SECRET')).toBeNull();
    expect(screen.getByText('填和换在桌面上做')).toBeTruthy();
  });

  it('cannot send without a device key, and says why', async () => {
    h.hasKey = false;
    const screen = await render(<MeEnvScreen />);
    await openSheet(screen, 'P1_SECRET');

    expect(screen.getByTestId('secret-sheet-ask').props.accessibilityState.disabled).toBe(true);
    expect(screen.getAllByText('这台设备还没有签名密钥，先按邀请链接配对。').length).toBeGreaterThan(0);
  });
});
