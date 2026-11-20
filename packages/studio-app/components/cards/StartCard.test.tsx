import React from 'react';
import { cleanup, fireEvent, render } from '@testing-library/react-native';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const hapticsSuccess = vi.fn();
const hapticsWarning = vi.fn();
vi.mock('expo-localization', () => ({ getLocales: () => [{ languageCode: 'zh' }] }));
vi.mock('../../lib/kv', () => ({ kv: { get: () => undefined, set: () => {}, remove: () => {} } }));
vi.mock('../../lib/haptics', () => ({
  haptics: {
    select: vi.fn(),
    success: (...args: unknown[]) => hapticsSuccess(...args),
    warning: (...args: unknown[]) => hapticsWarning(...args),
  },
}));

import { undoStore } from '../../lib/undo';
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
    vi.useFakeTimers();
    undoStore.cancel();
    hapticsSuccess.mockClear();
    hapticsWarning.mockClear();
  });

  afterEach(async () => {
    undoStore.cancel();
    await cleanup();
    vi.useRealTimers();
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

  it('does not call onStart or haptics if cancelled within 4s undo window', async () => {
    const onStart = vi.fn().mockResolvedValue(undefined);
    const screen = await render(
      <StartCard card={sampleCard} onDecline={() => {}} onStart={onStart} hasKeyOverride />,
    );

    await fireEvent.press(screen.getByTestId('start-approve'));
    expect(undoStore.getState().active).toBe(true);
    expect(undoStore.getState().remaining).toBe(4);
    expect(onStart).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(2000);
    expect(onStart).not.toHaveBeenCalled();

    undoStore.cancel();
    await vi.advanceTimersByTimeAsync(4000);
    expect(onStart).not.toHaveBeenCalled();
    expect(hapticsSuccess).not.toHaveBeenCalled();
  });

  it('calls onStart and haptics.success after 4s undo window', async () => {
    const onStart = vi.fn().mockResolvedValue(undefined);
    const screen = await render(
      <StartCard card={sampleCard} onDecline={() => {}} onStart={onStart} hasKeyOverride />,
    );

    expect(screen.getByText('由这台设备确认')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('start-approve'));
    expect(onStart).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(4000);
    await vi.waitFor(() => expect(screen.getByTestId('start-confirmed-hint')).toBeTruthy());
    expect(onStart).toHaveBeenCalledTimes(1);
    expect(hapticsSuccess).toHaveBeenCalledTimes(1);
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

  it('shows working while onStart is pending and completes only after resolve', async () => {
    let resolveFn!: () => void;
    const onStart = vi.fn(
      () =>
        new Promise<void>((res) => {
          resolveFn = res;
        }),
    );
    const screen = await render(
      <StartCard card={sampleCard} onDecline={() => {}} onStart={onStart} hasKeyOverride />,
    );

    await fireEvent.press(screen.getByTestId('start-approve'));
    await vi.advanceTimersByTimeAsync(4000);

    await vi.waitFor(() => expect(screen.getByTestId('start-approve').props.accessibilityState.busy).toBe(true));
    expect(screen.queryByTestId('start-confirmed-hint')).toBeNull();
    expect(hapticsSuccess).not.toHaveBeenCalled();

    resolveFn();
    await vi.waitFor(() => expect(screen.getByTestId('start-confirmed-hint')).toBeTruthy());
    expect(hapticsSuccess).toHaveBeenCalledTimes(1);
  });

  it('returns to idle with error and calls haptics.warning when onStart rejects', async () => {
    const onStart = vi.fn().mockRejectedValue(new Error('机器暂未在线'));
    const screen = await render(
      <StartCard card={sampleCard} onDecline={() => {}} onStart={onStart} hasKeyOverride />,
    );

    await fireEvent.press(screen.getByTestId('start-approve'));
    await vi.advanceTimersByTimeAsync(4000);

    await vi.waitFor(() => expect(screen.getByText('机器暂未在线')).toBeTruthy());
    expect(screen.getByTestId('start-approve').props.accessibilityState.busy).toBe(false);
    expect(screen.getByTestId('start-approve').props.accessibilityState.disabled).toBe(false);
    expect(screen.queryByTestId('start-confirmed-hint')).toBeNull();
    expect(hapticsWarning).toHaveBeenCalledTimes(1);
    expect(hapticsSuccess).not.toHaveBeenCalled();
  });
});
