import { describe, expect, it, vi } from 'vitest';

const { selectionAsync, notificationAsync } = vi.hoisted(() => ({
  selectionAsync: vi.fn(async () => {}),
  notificationAsync: vi.fn(async () => {}),
}));

vi.mock('expo-haptics', () => ({
  selectionAsync,
  notificationAsync,
  NotificationFeedbackType: {
    Success: 'success',
    Warning: 'warning',
  },
}));

import { haptics, select, success, warning } from './haptics';

describe('haptics', () => {
  it('fires at most once per tick across exports', async () => {
    selectionAsync.mockClear();
    notificationAsync.mockClear();

    select();
    success();
    warning();
    haptics.select();

    expect(selectionAsync).toHaveBeenCalledTimes(1);
    expect(notificationAsync).not.toHaveBeenCalled();

    await Promise.resolve();

    success();
    expect(notificationAsync).toHaveBeenCalledTimes(1);
  });
});
