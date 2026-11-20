import React from 'react';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const hapticsSuccess = vi.fn();
const hapticsWarning = vi.fn();

vi.mock('expo-localization', () => ({ getLocales: () => [{ languageCode: 'zh' }] }));
vi.mock('../../lib/kv', () => ({ kv: { get: () => undefined, set: () => {}, remove: () => {} } }));
vi.mock('../../lib/keys', () => ({
  useHasDeviceKey: () => ({ hasKey: true, loading: false, refresh: vi.fn() }),
}));
vi.mock('../../lib/haptics', () => ({
  haptics: {
    select: vi.fn(),
    success: (...args: unknown[]) => hapticsSuccess(...args),
    warning: (...args: unknown[]) => hapticsWarning(...args),
  },
}));

import { setScheme } from '../../lib/theme';
import { undoStore } from '../../lib/undo';
import { UnderstandingCard, type UnderstandingCardData } from './UnderstandingCard';

const SEVEN_POINTS: UnderstandingCardData = {
  id: 'card-u-7',
  kind: 'understanding',
  createdAt: 1000,
  status: 'pending',
  points: ['要点 1', '要点 2', '要点 3', '要点 4', '要点 5', '要点 6', '要点 7'],
  outOfScope: ['本次不做 Apple 登录'],
  requiresSignature: true,
};

describe('UnderstandingCard (SS-43 / SS-188 / SS-202)', () => {
  beforeEach(() => {
    hapticsSuccess.mockClear();
    hapticsWarning.mockClear();
  });

  afterEach(() => {
    undoStore.cancel();
    vi.useRealTimers();
  });

  it('folds points beyond 5 and expands on toggle with >=44pt hit targets', async () => {
    setScheme('light');
    const screen = await render(<UnderstandingCard card={SEVEN_POINTS} lang="zh" hasKeyOverride />);

    expect(screen.getByText('要点 1')).toBeTruthy();
    expect(screen.getByText('要点 5')).toBeTruthy();
    expect(screen.queryByText('要点 6')).toBeNull();
    expect(screen.queryByText('要点 7')).toBeNull();
    expect(screen.getByText('展开其余 2 条')).toBeTruthy();

    const toggle = screen.getByTestId('understanding-toggle');
    const toggleStyle = Object.assign({}, ...(Array.isArray(toggle.props.style) ? toggle.props.style : [toggle.props.style]));
    expect(toggleStyle.minHeight).toBeGreaterThanOrEqual(44);
    expect(toggleStyle.minWidth).toBeGreaterThanOrEqual(44);

    const rejectBtn = screen.getByTestId('understanding-reject');
    const rejectStyle = Object.assign({}, ...(Array.isArray(rejectBtn.props.style) ? rejectBtn.props.style : [rejectBtn.props.style]));
    expect(rejectStyle.minHeight).toBeGreaterThanOrEqual(44);

    await fireEvent.press(toggle);
    expect(screen.getByText('要点 6')).toBeTruthy();
    expect(screen.getByText('要点 7')).toBeTruthy();
    expect(screen.getByText('收起')).toBeTruthy();
  });

  it('disables SignedButton and explains when device key is missing', async () => {
    setScheme('light');
    const onConfirm = vi.fn();
    const screen = await render(
      <UnderstandingCard card={SEVEN_POINTS} lang="zh" hasKeyOverride={false} onConfirm={onConfirm} />,
    );

    const btn = screen.getByTestId('understanding-confirm');
    expect(btn.props.accessibilityState.disabled).toBe(true);
    expect(screen.getByText('这台设备还没有登记密钥，无法确认此操作；请前往「我 › 设备」添加设备。')).toBeTruthy();

    await fireEvent.press(btn);
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it('shows working state after 4s undo window until onConfirm resolves, then confirmed + success haptic', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    setScheme('light');

    let resolveConfirm!: () => void;
    const onConfirm = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          resolveConfirm = resolve;
        }),
    );

    const screen = await render(
      <UnderstandingCard card={SEVEN_POINTS} lang="zh" hasKeyOverride onConfirm={onConfirm} />,
    );

    // 4 秒撤销窗口内未发出
    await fireEvent.press(screen.getByTestId('understanding-confirm'));
    expect(onConfirm).not.toHaveBeenCalled();
    expect(undoStore.getState().active).toBe(true);

    // 撤销后回到 pending
    await act(async () => {
      undoStore.cancel();
    });
    expect(onConfirm).not.toHaveBeenCalled();
    expect(screen.getByTestId('understanding-confirm')).toBeTruthy();

    // 再次点击并等待 4 秒到点：进入 working 态，尚未 confirmed
    await fireEvent.press(screen.getByTestId('understanding-confirm'));
    await act(async () => {
      vi.advanceTimersByTime(4000);
    });
    expect(onConfirm).toHaveBeenCalledWith('card-u-7');
    expect(screen.getByTestId('understanding-confirm').props.accessibilityState.busy).toBe(true);
    expect(screen.queryByTestId('understanding-confirmed')).toBeNull();

    // resolve 后才变成已确认并触发 success 触感
    await act(async () => {
      resolveConfirm();
    });
    expect(screen.getByTestId('understanding-confirmed')).toBeTruthy();
    expect(hapticsSuccess).toHaveBeenCalledTimes(1);
  });

  it('returns to pending with error message and warning haptic when onConfirm rejects', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    setScheme('light');

    const onConfirm = vi.fn().mockRejectedValueOnce(new Error('签名服务暂不可用'));
    const screen = await render(
      <UnderstandingCard card={SEVEN_POINTS} lang="zh" hasKeyOverride onConfirm={onConfirm} />,
    );

    await fireEvent.press(screen.getByTestId('understanding-confirm'));
    await act(async () => {
      vi.advanceTimersByTime(4000);
    });

    await waitFor(() => {
      expect(screen.getByTestId('understanding-confirm')).toBeTruthy();
      expect(screen.getByText('签名服务暂不可用')).toBeTruthy();
    });
    expect(screen.queryByTestId('understanding-confirmed')).toBeNull();
    expect(hapticsWarning).toHaveBeenCalledTimes(1);
  });

  it('uses PrimaryButton instead of SignedButton when requiresSignature is false', async () => {
    setScheme('light');
    const card: UnderstandingCardData = { ...SEVEN_POINTS, id: 'card-u-nosig', requiresSignature: false };
    const screen = await render(<UnderstandingCard card={card} lang="zh" hasKeyOverride={false} />);

    // 即使没有设备密钥也仍可点击，且不显示设备密钥说明
    expect(screen.getByTestId('understanding-confirm').props.accessibilityState.disabled).toBe(false);
    expect(screen.queryByText('由这台设备确认')).toBeNull();
    expect(screen.queryByText(/没有登记密钥/)).toBeNull();
  });

  it('uses ellipsis on negative button and 16pt fontSize on reasonInput', async () => {
    setScheme('light');
    const onReject = vi.fn();
    const screen = await render(
      <UnderstandingCard card={SEVEN_POINTS} lang="zh" hasKeyOverride={false} onReject={onReject} />,
    );

    expect(screen.getByText('不对…')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('understanding-reject'));

    const reasonInput = screen.getByTestId('understanding-reason-input');
    const inputStyle = Object.assign({}, ...(Array.isArray(reasonInput.props.style) ? reasonInput.props.style : [reasonInput.props.style]));
    expect(inputStyle.fontSize).toBe(16);

    await fireEvent.changeText(reasonInput, '第 3 条还要支持邮箱');
    await fireEvent.press(screen.getByTestId('understanding-reason-submit'));

    await waitFor(() => {
      expect(onReject).toHaveBeenCalledWith('card-u-7', '第 3 条还要支持邮箱');
      expect(screen.getByTestId('understanding-rejected')).toBeTruthy();
    });
  });
});
