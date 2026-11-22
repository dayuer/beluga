import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('react-native', () => ({
  AppState: {
    addEventListener: vi.fn(() => ({ remove: vi.fn() })),
  },
}));

import { checkOnline, isOnline, refreshOnline, subscribeOnline } from './net';

describe('net', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('returns true if at least one probe responds', async () => {
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(new Error('network down'))
      .mockResolvedValueOnce({ status: 204 });
    vi.stubGlobal('fetch', fetchMock);

    await expect(checkOnline(500)).resolves.toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('returns false when all probes fail and notifies subscribers on change', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')));

    const events: boolean[] = [];
    const unsub = subscribeOnline((next) => events.push(next));

    await expect(refreshOnline()).resolves.toBe(false);
    expect(isOnline()).toBe(false);
    expect(events).toEqual([false]);

    // 恢复网络
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ status: 200 }));
    await expect(refreshOnline()).resolves.toBe(true);
    expect(isOnline()).toBe(true);
    expect(events).toEqual([false, true]);

    unsub();
  });
});
