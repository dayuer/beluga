import { fireEvent, render } from '@testing-library/react-native';
import { describe, expect, it, vi } from 'vitest';
import type { SettingsView } from '../lib/views';

const twoProjectSettings: SettingsView = {
  projects: [
    { id: 'p1', name: '项目一', platform: 'ios', runMode: 'auto-delivery', prodEnabled: true },
    { id: 'p2', name: '项目二', platform: 'web', runMode: 'every-step', prodEnabled: false },
  ],
  envs: {
    p1: [
      {
        id: 'test',
        title: '测试',
        protected: false,
        target: { platform: 'ios', appId: 'com.p1', mode: 'TestFlight' },
        vars: [],
        secrets: [
          {
            name: 'P1_SECRET',
            purpose: 'P1 签名用途',
            at: 1000,
            by: { name: '张三', via: 'studio' },
          },
        ],
      },
    ],
    p2: [
      {
        id: 'test',
        title: '测试',
        protected: false,
        target: { platform: 'web', appId: 'p2.web', mode: '预览环境' },
        vars: [],
        secrets: [
          {
            name: 'P2_SECRET',
            purpose: 'P2 数据库密钥用途',
            at: 2000,
            by: { name: '李四', via: 'studio' },
          },
        ],
      },
    ],
  },
  forges: [],
  runners: [],
  devices: [],
  account: { email: 'a@b.c', pushEnabled: true, appearance: 'system' },
};

vi.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));
// Drawer (SS-227 的密钥抽屉) 经 viewport 引入键盘模块，测试里不需要真实键盘。
vi.mock('../lib/viewport', () => ({ useKeyboardInset: () => 0 }));
vi.mock('./Header', () => ({ Header: () => null }));
vi.mock('./Skeleton', () => ({ Skeleton: () => null }));
vi.mock('expo-localization', () => ({ getLocales: () => [{ languageCode: 'zh' }] }));
vi.mock('../lib/kv', () => ({ kv: { get: () => undefined, set: () => {}, remove: () => {} } }));
vi.mock('../lib/settings-source', () => ({
  useSettingsView: () => ({
    data: twoProjectSettings,
    loading: false,
    offline: false,
    error: false,
    refresh: vi.fn(),
  }),
}));

import MeEnvScreen from '../app/me/env';
import { deliveryModeLabel } from '../app/me/project';

describe('Project delivery modes & Env project switching (SS-201)', () => {
  it('distinguishes preview-only, repo, and push-mine delivery modes', () => {
    const a = deliveryModeLabel('preview-only', 'zh');
    const b = deliveryModeLabel('repo', 'zh');
    const c = deliveryModeLabel('push-mine', 'zh');
    expect(new Set([a, b, c]).size).toBe(3);

    const aEn = deliveryModeLabel('preview-only', 'en');
    const bEn = deliveryModeLabel('repo', 'en');
    const cEn = deliveryModeLabel('push-mine', 'en');
    expect(new Set([aEn, bEn, cEn]).size).toBe(3);
  });

  it('switches projects on MeEnvScreen and shows secret purpose without value', async () => {
    const { getByTestId, queryByTestId } = await render(<MeEnvScreen />);

    expect(getByTestId('env-row-P1_SECRET')).toBeTruthy();
    expect(getByTestId('env-purpose-P1_SECRET').props.children).toBe('P1 签名用途');
    expect(queryByTestId('env-row-P2_SECRET')).toBeNull();

    await fireEvent.press(getByTestId('env-project-p2'));
    expect(getByTestId('env-row-P2_SECRET')).toBeTruthy();
    expect(getByTestId('env-purpose-P2_SECRET').props.children).toBe('P2 数据库密钥用途');
    expect(queryByTestId('env-row-P1_SECRET')).toBeNull();
  });
});
