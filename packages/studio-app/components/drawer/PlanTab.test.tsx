import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';
import { describe, expect, it, vi } from 'vitest';

vi.mock('expo-localization', () => ({ getLocales: () => [{ languageCode: 'zh' }] }));
vi.mock('../../lib/kv', () => ({ kv: { get: () => undefined, set: () => {}, remove: () => {} } }));

import { DEMO_RESULT_DRAWER } from '../../lib/demo/screens';
import { setScheme } from '../../lib/theme';
import { PlanTab } from './PlanTab';

describe('PlanTab (SS-48)', () => {
  it('switches among Map, Outline, and Activity sub-tabs', async () => {
    setScheme('light');
    const screen = await render(<PlanTab plan={DEMO_RESULT_DRAWER.plan} lang="zh" />);

    expect(screen.getByTestId('plan-map')).toBeTruthy();

    await fireEvent.press(screen.getByTestId('plan-subtab-outline'));
    expect(screen.getByTestId('plan-outline')).toBeTruthy();

    await fireEvent.press(screen.getByTestId('plan-subtab-activity'));
    expect(screen.getByTestId('activity-list')).toBeTruthy();
    expect(screen.getByText('客户确认需求理解')).toBeTruthy();
  });
});
