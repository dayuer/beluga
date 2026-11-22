import React from 'react';
import { cleanup, fireEvent, render } from '@testing-library/react-native';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const hapticsSuccess = vi.fn();
const hapticsWarning = vi.fn();
vi.mock('react-native', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    Image: (props: Record<string, unknown>) => React.createElement('Image', props),
    Linking: { openURL: vi.fn() },
  };
});
vi.mock('expo-localization', () => ({ getLocales: () => [{ languageCode: 'zh' }] }));
vi.mock('../lib/kv', () => ({ kv: { get: () => undefined, set: () => {}, remove: () => {} } }));
vi.mock('../lib/haptics', () => ({
  haptics: {
    select: vi.fn(),
    success: (...args: unknown[]) => hapticsSuccess(...args),
    warning: (...args: unknown[]) => hapticsWarning(...args),
  },
}));

import { undoStore } from '../lib/undo';
import type { KnownStudioCard } from '../lib/views';
type DeliveryCard = Extract<KnownStudioCard, { kind: 'delivery' }>;
import { AcceptCard } from './AcceptCard';

const sampleCard: DeliveryCard = {
  id: 'card-delivery-1',
  kind: 'delivery',
  createdAt: 1_763_600_000_000,
  status: 'pending',
  round: 2,
  summary: '第 2 轮交付已部署到测试环境，检查全部通过。',
  criteria: ['记录后列表立刻更新', '关掉 App 再打开数据还在'],
  previewUrl: 'https://demo-preview.synon.invalid/req-export',
  screenshots: ['https://demo-preview.synon.invalid/shot1.png'],
  requiresSignature: true,
};

describe('AcceptCard (P5)', () => {
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

  it('lists the acceptance criteria above what to check (P5 walkthrough)', async () => {
    const screen = await render(<AcceptCard card={sampleCard} onNotYet={() => {}} onSigned={() => {}} />);
    expect(screen.getByTestId('accept-criteria')).toBeTruthy();
    expect(screen.getByText(/记录后列表立刻更新/)).toBeTruthy();
    expect(screen.getByText(/关掉 App 再打开数据还在/)).toBeTruthy();
  });

  it('disables approve button when device has no key', async () => {
    const screen = await render(<AcceptCard card={sampleCard} onNotYet={() => {}} onSigned={() => {}} />);
    const approve = screen.getByTestId('accept-approve');
    expect(approve.props.accessibilityState.disabled).toBe(true);
    expect(screen.getByText(/我 › 设备/)).toBeTruthy();
  });

  it('does not fire onSigned or haptics if cancelled within 10s undo window', async () => {
    const onSigned = vi.fn();
    const screen = await render(
      <AcceptCard card={sampleCard} onNotYet={() => {}} onSigned={onSigned} hasKeyOverride />,
    );

    fireEvent.press(screen.getByTestId('accept-approve'));
    expect(undoStore.getState().active).toBe(true);
    expect(undoStore.getState().remaining).toBe(10);
    expect(onSigned).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(5000);
    expect(onSigned).not.toHaveBeenCalled();

    undoStore.cancel();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(onSigned).not.toHaveBeenCalled();
    expect(hapticsSuccess).not.toHaveBeenCalled();
  });

  it('fires onSigned and triggers haptics.success once after 10s window', async () => {
    const onSigned = vi.fn();
    const screen = await render(
      <AcceptCard card={sampleCard} onNotYet={() => {}} onSigned={onSigned} hasKeyOverride />,
    );

    fireEvent.press(screen.getByTestId('accept-approve'));
    await vi.advanceTimersByTimeAsync(10_000);

    expect(onSigned).toHaveBeenCalledTimes(1);
    expect(hapticsSuccess).toHaveBeenCalledTimes(1);
  });

  it('triggers onNotYet and onOpenPreview actions', async () => {
    const onNotYet = vi.fn();
    const onOpenPreview = vi.fn();
    const screen = await render(
      <AcceptCard
        card={sampleCard}
        onNotYet={onNotYet}
        onSigned={() => {}}
        onOpenPreview={onOpenPreview}
        hasKeyOverride
      />,
    );

    await fireEvent.press(screen.getByTestId('accept-not-yet'));
    expect(onNotYet).toHaveBeenCalledTimes(1);

    await fireEvent.press(screen.getByTestId('accept-open-preview'));
    expect(onOpenPreview).toHaveBeenCalledWith('https://demo-preview.synon.invalid/req-export');
  });

  it('shows both previewUrl and installUrl entrances and resets state when card changes', async () => {
    const onOpenPreview = vi.fn();
    const bothCard: DeliveryCard = {
      ...sampleCard,
      installUrl: 'https://demo-preview.synon.invalid/req-export.ipa',
    };
    const screen = await render(
      <AcceptCard card={bothCard} onNotYet={() => {}} onSigned={() => {}} onOpenPreview={onOpenPreview} hasKeyOverride />,
    );

    await fireEvent.press(screen.getByTestId('accept-open-preview'));
    expect(onOpenPreview).toHaveBeenCalledWith('https://demo-preview.synon.invalid/req-export');

    await fireEvent.press(screen.getByTestId('accept-open-install'));
    expect(onOpenPreview).toHaveBeenCalledWith('https://demo-preview.synon.invalid/req-export.ipa');

    await fireEvent.press(screen.getByTestId('accept-approve'));
    expect(screen.getByTestId('accept-pending-undo')).toBeTruthy();

    await screen.rerender(
      <AcceptCard
        card={{ ...bothCard, id: 'card-delivery-2', status: 'pending' }}
        onNotYet={() => {}}
        onSigned={() => {}}
        onOpenPreview={onOpenPreview}
        hasKeyOverride
      />,
    );
    expect(screen.queryByTestId('accept-pending-undo')).toBeNull();
    expect(screen.getByTestId('accept-approve')).toBeTruthy();
  });

  it('shows working while onSigned is pending and only completes after resolve', async () => {
    let resolveFn!: () => void;
    const onSigned = vi.fn(
      () =>
        new Promise<void>((res) => {
          resolveFn = res;
        }),
    );
    const screen = await render(
      <AcceptCard card={sampleCard} onNotYet={() => {}} onSigned={onSigned} hasKeyOverride />,
    );

    await fireEvent.press(screen.getByTestId('accept-approve'));
    await vi.advanceTimersByTimeAsync(10_000);

    await vi.waitFor(() => expect(screen.getByTestId('accept-approve').props.accessibilityState.busy).toBe(true));
    expect(screen.queryByTestId('accept-approved-hint')).toBeNull();
    expect(hapticsSuccess).not.toHaveBeenCalled();

    resolveFn();
    await vi.waitFor(() => expect(screen.getByTestId('accept-approved-hint')).toBeTruthy());
    expect(hapticsSuccess).toHaveBeenCalledTimes(1);
  });

  it('returns to idle with error and calls haptics.warning when onSigned rejects', async () => {
    const onSigned = vi.fn().mockRejectedValue(new Error('签名服务暂不可用'));
    const screen = await render(
      <AcceptCard card={sampleCard} onNotYet={() => {}} onSigned={onSigned} hasKeyOverride />,
    );

    await fireEvent.press(screen.getByTestId('accept-approve'));
    await vi.advanceTimersByTimeAsync(10_000);

    await vi.waitFor(() => expect(screen.getByText('签名服务暂不可用')).toBeTruthy());
    expect(screen.getByTestId('accept-approve').props.accessibilityState.busy).toBe(false);
    expect(screen.getByTestId('accept-approve').props.accessibilityState.disabled).toBe(false);
    expect(screen.queryByTestId('accept-approved-hint')).toBeNull();
    expect(hapticsWarning).toHaveBeenCalledTimes(1);
    expect(hapticsSuccess).not.toHaveBeenCalled();
  });
});
