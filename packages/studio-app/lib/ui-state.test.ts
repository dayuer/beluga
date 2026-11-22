import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('react-native', () => ({}));

import { acquireDrawer, getDrawerCount, getDrawerOpen, resetDrawerCount } from './ui-state';

describe('ui-state drawer refcount', () => {
  afterEach(() => {
    resetDrawerCount();
  });

  it('keeps drawerOpen true while two drawers are stacked and restores only when both close', () => {
    expect(getDrawerOpen()).toBe(false);
    expect(getDrawerCount()).toBe(0);

    const releaseFirst = acquireDrawer();
    expect(getDrawerOpen()).toBe(true);
    expect(getDrawerCount()).toBe(1);

    const releaseSecond = acquireDrawer();
    expect(getDrawerOpen()).toBe(true);
    expect(getDrawerCount()).toBe(2);

    // 先关一个，仍然隐藏
    releaseFirst();
    expect(getDrawerOpen()).toBe(true);
    expect(getDrawerCount()).toBe(1);

    // 重复释放同一抽屉不重复减计数
    releaseFirst();
    expect(getDrawerOpen()).toBe(true);
    expect(getDrawerCount()).toBe(1);

    // 最后一个关掉才恢复
    releaseSecond();
    expect(getDrawerOpen()).toBe(false);
    expect(getDrawerCount()).toBe(0);
  });

  it('restores on unmount cleanup even if closed via component unmount', () => {
    const unmountCleanup = acquireDrawer();
    expect(getDrawerOpen()).toBe(true);

    unmountCleanup();
    expect(getDrawerOpen()).toBe(false);
  });
});
