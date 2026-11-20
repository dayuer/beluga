import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';
import { Text } from 'react-native';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('expo-localization', () => ({ getLocales: () => [{ languageCode: 'zh' }] }));
vi.mock('../lib/kv', () => ({ kv: { get: () => undefined, set: () => {}, remove: () => {} } }));

import { getDrawerOpen, resetDrawerCount } from '../lib/ui-state';
import { Drawer, shouldDismissDrawer, type DrawerTab } from './Drawer';

describe('Drawer (SS-47)', () => {
  afterEach(() => {
    resetDrawerCount();
  });

  it('evaluates drag threshold (>30% height or fast fling)', () => {
    expect(shouldDismissDrawer(100, 100, 500)).toBe(false);
    expect(shouldDismissDrawer(160, 100, 500)).toBe(true); // > 150 (30%)
    expect(shouldDismissDrawer(40, 950, 500)).toBe(true); // velocity > 900
    expect(shouldDismissDrawer(-50, 1200, 500)).toBe(false);
  });

  it('renders injected tabs without knowing tab contents, syncs ui-state.drawerOpen, and closes on scrim press', async () => {
    const onClose = vi.fn();
    const tabs: readonly DrawerTab[] = [
      { key: 'plan', label: '计划', render: () => <Text>计划内容</Text> },
      { key: 'outputs', label: '成果', render: () => <Text>成果内容</Text> },
    ];

    const screen = await render(<Drawer open onClose={onClose} title="结果" tabs={tabs} />);
    expect(getDrawerOpen()).toBe(true);
    expect(screen.getByText('计划内容')).toBeTruthy();

    await fireEvent.press(screen.getByTestId('drawer-tab-outputs'));
    expect(screen.getByText('成果内容')).toBeTruthy();

    await fireEvent.press(screen.getByTestId('drawer-scrim', { includeHiddenElements: true }));
    expect(onClose).toHaveBeenCalledTimes(1);

    await screen.unmount();
    expect(getDrawerOpen()).toBe(false);
  });
});
