import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';
import { describe, expect, it, vi } from 'vitest';

vi.mock('expo-localization', () => ({ getLocales: () => [{ languageCode: 'zh' }] }));
vi.mock('../../lib/kv', () => ({ kv: { get: () => undefined, set: () => {}, remove: () => {} } }));

import { DeliveryCard, type DeliveryCardModel } from './DeliveryCard';

const sampleCard: DeliveryCardModel = {
  id: 'card-delivery-1',
  kind: 'delivery',
  createdAt: 1_763_600_000_000,
  status: 'done',
  round: 2,
  summary: '第 2 轮交付已部署到测试环境，检查全部通过。',
  criteria: [],
  previewUrl: 'https://demo-preview.synon.invalid/req-export',
  screenshots: [],
  requiresSignature: false,
};

describe('DeliveryCard', () => {
  it('renders checks passed, merged, preview URL, and does not require device key to open preview tab', async () => {
    const onOpenPreviewTab = vi.fn();
    const screen = await render(<DeliveryCard card={sampleCard} onOpenPreviewTab={onOpenPreviewTab} />);

    expect(screen.getByText('第 2 轮已交付')).toBeTruthy();
    expect(screen.getByTestId('delivery-checks-passed')).toBeTruthy();
    expect(screen.getByTestId('delivery-merged')).toBeTruthy();
    expect(screen.getByText('https://demo-preview.synon.invalid/req-export')).toBeTruthy();
    expect(screen.queryByText(/由这台设备确认/)).toBeNull();
    expect(screen.queryByText(/我 › 设备/)).toBeNull();

    const btn = screen.getByTestId('delivery-open-preview');
    expect(btn.props.accessibilityState.disabled).toBe(false);

    await fireEvent.press(btn);
    expect(onOpenPreviewTab).toHaveBeenCalledWith('https://demo-preview.synon.invalid/req-export');
  });
});
