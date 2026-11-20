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

import { StartCard, type StartCardModel } from './StartCard';

const sampleCard: StartCardModel = {
  id: 'card-start-1',
  kind: 'start',
  createdAt: 1_763_600_000_000,
  status: 'pending',
  planTitle: '登录页改版与一键登录',
  stepCount: 4,
  estimateLabel: '预计约 2 小时',
  requiresSignature: true,
};

describe('StartCard (P10)', () => {
  beforeEach(() => {
    hapticsSuccess.mockClear();
  });

  it('renders steps, estimate, how, when, and disables SignedButton without device key', async () => {
    const screen = await render(<StartCard card={sampleCard} onDecline={() => {}} onStart={() => {}} />);

    expect(screen.getByText('登录页改版与一键登录')).toBeTruthy();
    expect(screen.getByText('共 4 步')).toBeTruthy();
    expect(screen.getByText('预计约 2 小时')).toBeTruthy();
    expect(screen.getByText('确认后立即开始')).toBeTruthy();
    expect(screen.getByTestId('start-approve').props.accessibilityState.disabled).toBe(true);
    expect(screen.getByText(/我 › 设备/)).toBeTruthy();
  });

  it('calls onStart and haptics.success when approved with device key', async () => {
    const onStart = vi.fn().mockResolvedValue(undefined);
    const onDecline = vi.fn();
    const screen = await render(
      <StartCard card={sampleCard} onDecline={onDecline} onStart={onStart} hasKeyOverride />,
    );

    expect(screen.getByText('由这台设备确认')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('start-approve'));

    await vi.waitFor(() => expect(onStart).toHaveBeenCalledTimes(1));
    expect(hapticsSuccess).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId('start-confirmed-hint')).toBeTruthy();
  });

  it('calls onDecline when left button pressed', async () => {
    const onDecline = vi.fn();
    const screen = await render(
      <StartCard card={sampleCard} onDecline={onDecline} onStart={() => {}} hasKeyOverride />,
    );
    await fireEvent.press(screen.getByTestId('start-decline'));
    expect(onDecline).toHaveBeenCalledTimes(1);
  });

  it('renders "在结果区看计划" when onOpenPlan is provided and calls it on press', async () => {
    const onOpenPlan = vi.fn();
    const screen = await render(
      <StartCard card={sampleCard} onOpenPlan={onOpenPlan} onDecline={() => {}} onStart={() => {}} hasKeyOverride />,
    );

    expect(screen.getByText('在结果区看计划')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('start-open-plan'));
    expect(onOpenPlan).toHaveBeenCalledTimes(1);
  });
});
