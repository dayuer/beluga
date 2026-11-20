import React from 'react';
import { render } from '@testing-library/react-native';
import { describe, expect, it, vi } from 'vitest';

vi.mock('expo-localization', () => ({ getLocales: () => [{ languageCode: 'zh' }] }));
vi.mock('expo-secure-store', () => ({ getItemAsync: async () => null, setItemAsync: async () => {} }));
vi.mock('../../lib/kv', () => ({ kv: { get: () => undefined, set: () => {}, remove: () => {} } }));
vi.mock('../../lib/send', () => ({
  pendingKey: () => 'k',
  useSend: () => ({ state: { phase: 'idle' }, send: vi.fn(), retry: vi.fn() }),
}));

import { DEMO_RESULT_DRAWER } from '../../lib/demo/screens';
import { setScheme } from '../../lib/theme';
import { ChangesTab } from './ChangesTab';

describe('ChangesTab (SS-50)', () => {
  it('renders InlineHint when empty', async () => {
    setScheme('light');
    const screen = await render(
      <ChangesTab changes={{ added: [], modified: [], removed: [], pendingApproval: false }} lang="zh" />,
    );
    expect(screen.getByTestId('drawer-changes-tab-empty')).toBeTruthy();
    expect(screen.getByText('还没有改动记录')).toBeTruthy();
  });

  it('renders read-only diff list with milestone header and pending hint', async () => {
    setScheme('light');
    const screen = await render(
      <ChangesTab changes={DEMO_RESULT_DRAWER.changes} milestones={DEMO_RESULT_DRAWER.plan.milestones} lang="zh" />,
    );
    expect(screen.getByTestId('drawer-changes-tab-pending')).toBeTruthy();
    expect(screen.getByTestId('readonly-diff-list')).toBeTruthy();
    expect(screen.getByText('密码明文切换按钮')).toBeTruthy();
    expect(screen.getByText('登录按钮防连点逻辑')).toBeTruthy();
  });
});
