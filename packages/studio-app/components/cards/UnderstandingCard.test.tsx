import React from 'react';
import { fireEvent, render, waitFor } from '@testing-library/react-native';
import { describe, expect, it, vi } from 'vitest';

vi.mock('expo-localization', () => ({ getLocales: () => [{ languageCode: 'zh' }] }));
vi.mock('../../lib/kv', () => ({ kv: { get: () => undefined, set: () => {}, remove: () => {} } }));

import { setScheme } from '../../lib/theme';
import { UnderstandingCard, type UnderstandingCardData } from './UnderstandingCard';

const SEVEN_POINTS: UnderstandingCardData = {
  id: 'card-u-7',
  kind: 'understanding',
  createdAt: 1000,
  status: 'pending',
  points: ['要点 1', '要点 2', '要点 3', '要点 4', '要点 5', '要点 6', '要点 7'],
  outOfScope: ['本次不做 Apple 登录'],
  requiresSignature: false,
};

describe('UnderstandingCard (SS-43)', () => {
  it('folds points beyond 5 and expands on toggle', async () => {
    setScheme('light');
    const screen = await render(<UnderstandingCard card={SEVEN_POINTS} lang="zh" />);

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

  it('supports confirm and reject with reason', async () => {
    setScheme('light');
    const onConfirm = vi.fn();
    const screen = await render(<UnderstandingCard card={SEVEN_POINTS} lang="zh" onConfirm={onConfirm} />);

    await fireEvent.press(screen.getByTestId('understanding-confirm'));
    await waitFor(() => {
      expect(onConfirm).toHaveBeenCalledWith('card-u-7');
      expect(screen.getByTestId('understanding-confirmed')).toBeTruthy();
    });

    const onReject = vi.fn();
    const screen2 = await render(<UnderstandingCard card={SEVEN_POINTS} lang="zh" onReject={onReject} />);
    await fireEvent.press(screen2.getByTestId('understanding-reject'));
    await fireEvent.changeText(screen2.getByTestId('understanding-reason-input'), '第 3 条还要支持邮箱');
    await fireEvent.press(screen2.getByTestId('understanding-reason-submit'));

    await waitFor(() => {
      expect(onReject).toHaveBeenCalledWith('card-u-7', '第 3 条还要支持邮箱');
      expect(screen2.getByTestId('understanding-rejected')).toBeTruthy();
    });
  });
});
