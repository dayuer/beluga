import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const hapticsSuccess = vi.fn();
vi.mock('expo-localization', () => ({ getLocales: () => [{ languageCode: 'zh' }] }));
vi.mock('../../lib/kv', () => ({ kv: { get: () => undefined, set: () => {}, remove: () => {} } }));
vi.mock('../../lib/haptics', () => ({
  haptics: {
    select: vi.fn(),
    success: (...args: unknown[]) => hapticsSuccess(...args),
    warning: vi.fn(),
  },
}));

import { ChangeCard, type ChangesCardModel } from './ChangeCard';

const sampleCard: ChangesCardModel = {
  id: 'card-changes-1',
  kind: 'changes',
  createdAt: 1_763_600_000_000,
  status: 'pending',
  summary: '根据你的反馈调整了登录页交互',
  added: ['密码明文切换按钮'],
  modified: ['登录按钮防连点逻辑'],
  removed: ['旧版验证码弹窗'],
  requiresSignature: true,
};

describe('ChangeCard', () => {
  beforeEach(() => {
    hapticsSuccess.mockClear();
  });

  it('renders added, modified, and removed sections and disables SignedButton without key', async () => {
    const screen = await render(<ChangeCard card={sampleCard} onDecline={() => {}} onApprove={() => {}} />);

    expect(screen.getByTestId('change-added')).toBeTruthy();
    expect(screen.getByText('密码明文切换按钮')).toBeTruthy();
    expect(screen.getByTestId('change-modified')).toBeTruthy();
    expect(screen.getByText('登录按钮防连点逻辑')).toBeTruthy();
    expect(screen.getByTestId('change-removed')).toBeTruthy();
    expect(screen.getByText('旧版验证码弹窗')).toBeTruthy();

    expect(screen.getByTestId('change-approve').props.accessibilityState.disabled).toBe(true);
    expect(screen.getByText(/我 › 设备/)).toBeTruthy();
  });

  it('calls onApprove and onDecline properly when key exists', async () => {
    const onApprove = vi.fn().mockResolvedValue(undefined);
    const onDecline = vi.fn();
    const screen = await render(
      <ChangeCard card={sampleCard} onDecline={onDecline} onApprove={onApprove} hasKeyOverride />,
    );

    await fireEvent.press(screen.getByTestId('change-decline'));
    expect(onDecline).toHaveBeenCalledTimes(1);

    await fireEvent.press(screen.getByTestId('change-approve'));
    await vi.waitFor(() => expect(onApprove).toHaveBeenCalledTimes(1));
    expect(hapticsSuccess).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId('change-approved-hint')).toBeTruthy();
  });

  it('renders before -> after details when diff is provided', async () => {
    const screen = await render(
      <ChangeCard
        card={sampleCard}
        diff={{
          draftRev: 2,
          added: [],
          changed: [{ kind: 'task', title: '登录按钮防连点逻辑', before: '禁用 500ms', after: '请求完成前保持禁用' }],
          removed: [],
        }}
        onDecline={() => {}}
        onApprove={() => {}}
        hasKeyOverride
      />,
    );

    expect(screen.getByTestId('change-before-after-0')).toBeTruthy();
    expect(screen.getByText('禁用 500ms')).toBeTruthy();
    expect(screen.getByText('请求完成前保持禁用')).toBeTruthy();
  });
});
