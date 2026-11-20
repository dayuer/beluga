import React from 'react';
import { act, fireEvent, render } from '@testing-library/react-native';
import { afterEach, describe, expect, it, vi } from 'vitest';

const { replaceMock, selectMock } = vi.hoisted(() => ({
  replaceMock: vi.fn(),
  selectMock: vi.fn(),
}));

vi.mock('expo-router', () => ({
  usePathname: () => '/',
  useRouter: () => ({ replace: replaceMock }),
}));
vi.mock('expo-localization', () => ({ getLocales: () => [{ languageCode: 'zh' }] }));
vi.mock('../lib/kv', () => ({ kv: { get: () => undefined, set: () => {}, remove: () => {} } }));
vi.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 34, left: 0, right: 0 }),
}));
vi.mock('../lib/haptics', () => ({ select: selectMock }));

import { acquireDrawer, resetDrawerCount } from '../lib/ui-state';
import { TabBar } from './TabBar';

describe('TabBar', () => {
  afterEach(() => {
    replaceMock.mockClear();
    selectMock.mockClear();
    resetDrawerCount();
  });

  it('renders three tabs (需求 · 待办 · 我), triggers haptics.select on switch, and hides when drawer is open', async () => {
    const screen = await render(<TabBar todoCount={3} />);
    expect(screen.getByText('需求')).toBeTruthy();
    expect(screen.getByText('待办')).toBeTruthy();
    expect(screen.getByText('我')).toBeTruthy();
    expect(screen.getByText('3')).toBeTruthy();

    await fireEvent.press(screen.getByTestId('tab-todo'));
    expect(selectMock).toHaveBeenCalledTimes(1);
    expect(replaceMock).toHaveBeenCalledWith('/todo');

    let release!: () => void;
    await act(async () => {
      release = acquireDrawer();
      await Promise.resolve();
    });
    expect(screen.toJSON()).toBeNull();

    await act(async () => {
      release();
      await Promise.resolve();
    });
    expect(screen.getByText('需求')).toBeTruthy();
  });
});
