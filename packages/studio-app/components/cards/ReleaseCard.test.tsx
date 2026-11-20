import React from 'react';
import { cleanup, fireEvent, render } from '@testing-library/react-native';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const hapticsSuccess = vi.fn();
const hapticsWarning = vi.fn();
vi.mock('expo-localization', () => ({ getLocales: () => [{ languageCode: 'zh' }] }));
vi.mock('../../lib/kv', () => ({ kv: { get: () => undefined, set: () => {}, remove: () => {} } }));
vi.mock('../../lib/viewport', () => ({ useKeyboardInset: () => 0 }));
vi.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));
vi.mock('../../lib/haptics', () => ({
  haptics: {
    select: vi.fn(),
    success: (...args: unknown[]) => hapticsSuccess(...args),
    warning: (...args: unknown[]) => hapticsWarning(...args),
  },
}));

import { resetDrawerCount } from '../../lib/ui-state';
import { ReleaseCard, type ReleaseCardModel } from './ReleaseCard';

const sampleCard: ReleaseCardModel = {
  id: 'card-release-1',
  kind: 'release',
  createdAt: 1_763_600_000_000,
  status: 'pending',
  envId: 'prod',
  envTitle: '正式环境',
  version: '1.8.3',
  lastVersion: '1.8.2',
  lastReleaseAt: 1_763_513_600_000,
  requiresSignature: true,
};

describe('ReleaseCard (P11)', () => {
  beforeEach(() => {
    hapticsSuccess.mockClear();
    hapticsWarning.mockClear();
  });

  afterEach(async () => {
    await cleanup();
    resetDrawerCount();
  });

  it('returns null when protectedEnv is false', async () => {
    const screen = await render(
      <ReleaseCard card={sampleCard} protectedEnv={false} onRelease={() => {}} />,
    );
    expect(screen.queryByTestId('release-card')).toBeNull();
  });

  it('renders version, live version, separate time & person columns, and disables SignedButton without key', async () => {
    const screen = await render(
      <ReleaseCard card={sampleCard} lastReleaseBy="张工" onDecline={() => {}} onRelease={() => {}} />,
    );

    expect(screen.getByTestId('release-target-version').props.children).toBe('1.8.3');
    expect(screen.getByTestId('release-live-version').props.children).toBe('1.8.2');
    expect(screen.getByTestId('release-last-time-col')).toBeTruthy();
    expect(screen.getByTestId('release-last-person-col')).toBeTruthy();
    expect(screen.getByText('张工')).toBeTruthy();
    expect(screen.getByTestId('release-approve').props.accessibilityState.disabled).toBe(true);
    expect(screen.getByText(/我 › 设备/)).toBeTruthy();
  });

  it('opens ConfirmSheet with primary label "上线" and triggers onRelease + haptics.success once on confirm', async () => {
    const onRelease = vi.fn().mockResolvedValue(undefined);
    const screen = await render(
      <ReleaseCard card={sampleCard} lastReleaseBy="张工" onDecline={() => {}} onRelease={onRelease} hasKeyOverride />,
    );

    await fireEvent.press(screen.getByTestId('release-approve'));
    expect(onRelease).not.toHaveBeenCalled();

    const confirmBtn = screen.getByTestId('release-confirm-sheet-confirm');
    expect(screen.getAllByText('上线').length).toBeGreaterThanOrEqual(2);

    await fireEvent.press(confirmBtn);
    await vi.waitFor(() => expect(onRelease).toHaveBeenCalledTimes(1));
    expect(hapticsSuccess).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId('release-done-hint').props.children).toBe('已上线 1.8.3');
  });

  it('shows working while onRelease is pending and completes only after resolve', async () => {
    let resolveFn!: () => void;
    const onRelease = vi.fn(
      () =>
        new Promise<void>((res) => {
          resolveFn = res;
        }),
    );
    const screen = await render(
      <ReleaseCard card={sampleCard} lastReleaseBy="张工" onDecline={() => {}} onRelease={onRelease} hasKeyOverride />,
    );

    await fireEvent.press(screen.getByTestId('release-approve'));
    await fireEvent.press(screen.getByTestId('release-confirm-sheet-confirm'));

    expect(screen.getByTestId('release-approve').props.accessibilityState.busy).toBe(true);
    expect(screen.queryByTestId('release-done-hint')).toBeNull();
    expect(hapticsSuccess).not.toHaveBeenCalled();

    resolveFn();
    await vi.waitFor(() => expect(screen.getByTestId('release-done-hint')).toBeTruthy());
    expect(hapticsSuccess).toHaveBeenCalledTimes(1);
  });

  it('returns to idle with error and calls haptics.warning when onRelease rejects', async () => {
    const onRelease = vi.fn().mockRejectedValue(new Error('发布令牌已过期'));
    const screen = await render(
      <ReleaseCard card={sampleCard} lastReleaseBy="张工" onDecline={() => {}} onRelease={onRelease} hasKeyOverride />,
    );

    await fireEvent.press(screen.getByTestId('release-approve'));
    await fireEvent.press(screen.getByTestId('release-confirm-sheet-confirm'));

    await vi.waitFor(() => expect(screen.getByText('发布令牌已过期')).toBeTruthy());
    expect(screen.getByTestId('release-approve').props.accessibilityState.busy).toBe(false);
    expect(screen.getByTestId('release-approve').props.accessibilityState.disabled).toBe(false);
    expect(screen.queryByTestId('release-done-hint')).toBeNull();
    expect(hapticsWarning).toHaveBeenCalledTimes(1);
    expect(hapticsSuccess).not.toHaveBeenCalled();
  });
});
