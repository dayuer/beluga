import React from 'react';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('expo-localization', () => ({ getLocales: () => [{ languageCode: 'zh' }] }));
vi.mock('../../lib/kv', () => ({ kv: { get: () => undefined, set: () => {}, remove: () => {} } }));
vi.mock('../../lib/keys', () => ({
  useHasDeviceKey: () => ({ hasKey: true, loading: false, refresh: vi.fn() }),
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

describe('UnderstandingCard (SS-43 / sign-in-app-2)', () => {
  afterEach(() => {
    undoStore.cancel();
    vi.useRealTimers();
  });

  it('folds points beyond 5 and expands on toggle', async () => {
    setScheme('light');
    const screen = await render(<UnderstandingCard card={SEVEN_POINTS} lang="zh" hasKeyOverride />);

    expect(screen.getByText('要点 1')).toBeTruthy();
    expect(screen.getByText('要点 5')).toBeTruthy();
    expect(screen.queryByText('要点 6')).toBeNull();
    expect(screen.queryByText('要点 7')).toBeNull();
    expect(screen.getByText('展开其余 2 条')).toBeTruthy();

    await fireEvent.press(screen.getByTestId('understanding-toggle'));
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

  it('runs a 4s undo window before firing confirm, and cancels cleanly on undo', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    setScheme('light');
    const onConfirm = vi.fn();
    const screen = await render(
      <UnderstandingCard card={SEVEN_POINTS} lang="zh" hasKeyOverride onConfirm={onConfirm} />,
    );

    // 点下主按钮进入 4 秒撤销窗口，期间不触发 onConfirm
    await fireEvent.press(screen.getByTestId('understanding-confirm'));
    expect(onConfirm).not.toHaveBeenCalled();
    expect(undoStore.getState().active).toBe(true);
    expect(screen.getByTestId('understanding-undoing')).toBeTruthy();

    // 在撤销窗口内撤销：不发签名，卡片恢复 pending
    await act(async () => {
      undoStore.cancel();
    });
    expect(onConfirm).not.toHaveBeenCalled();
    expect(screen.getByTestId('understanding-confirm')).toBeTruthy();

    // 再次点击并等待 4 秒结束：发出确认
    await fireEvent.press(screen.getByTestId('understanding-confirm'));
    await act(async () => {
      vi.advanceTimersByTime(4000);
    });
    expect(onConfirm).toHaveBeenCalledWith('card-u-7');
    expect(screen.getByTestId('understanding-confirmed')).toBeTruthy();
  });

  it('supports outlined negative action with reason without signing', async () => {
    setScheme('light');
    const onReject = vi.fn();
    const screen = await render(
      <UnderstandingCard card={SEVEN_POINTS} lang="zh" hasKeyOverride={false} onReject={onReject} />,
    );

    expect(screen.getByText('不对，我改一下')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('understanding-reject'));
    await fireEvent.changeText(screen.getByTestId('understanding-reason-input'), '第 3 条还要支持邮箱');
    await fireEvent.press(screen.getByTestId('understanding-reason-submit'));

    await waitFor(() => {
      expect(onReject).toHaveBeenCalledWith('card-u-7', '第 3 条还要支持邮箱');
      expect(screen.getByTestId('understanding-rejected')).toBeTruthy();
    });
  });
});
