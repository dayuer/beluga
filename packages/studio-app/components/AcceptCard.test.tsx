import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const hapticsSuccess = vi.fn();
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
    warning: vi.fn(),
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
  previewUrl: 'https://demo-preview.synon.invalid/req-export',
  screenshots: ['https://demo-preview.synon.invalid/shot1.png'],
  requiresSignature: true,
};

describe('AcceptCard (P5)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    undoStore.cancel();
    hapticsSuccess.mockClear();
  });

  afterEach(() => {
    undoStore.cancel();
    vi.useRealTimers();
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

    fireEvent.press(screen.getByTestId('accept-not-yet'));
    expect(onNotYet).toHaveBeenCalledTimes(1);

    fireEvent.press(screen.getByTestId('accept-open-preview'));
    expect(onOpenPreview).toHaveBeenCalledWith('https://demo-preview.synon.invalid/req-export');
  });
});
