import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('react-native', () => ({
  AppState: {
    addEventListener: vi.fn(() => ({ remove: vi.fn() })),
  },
}));

import { createUndoController } from './undo';

describe('undo', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-11-20T00:00:00.000Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('does not fire immediately on background, and fires only when deadline arrives', () => {
    const listeners = new Set<(state: string) => void>();
    const fire = vi.fn();
    const states: Array<{ active: boolean; remaining: number }> = [];

    const ctrl = createUndoController(
      10_000,
      (active, remaining) => states.push({ active, remaining }),
      (cb) => {
        listeners.add(cb);
        return () => listeners.delete(cb);
      },
    );

    ctrl.start(fire);
    expect(ctrl.active).toBe(true);
    expect(fire).not.toHaveBeenCalled();

    // 切到后台：不提前发送
    for (const cb of listeners) cb('background');
    vi.advanceTimersByTime(5_000);
    expect(fire).not.toHaveBeenCalled();
    expect(ctrl.active).toBe(true);

    // 到点才发
    vi.advanceTimersByTime(5_000);
    expect(fire).toHaveBeenCalledTimes(1);
    expect(ctrl.active).toBe(false);

    ctrl.dispose();
  });

  it('fires immediately on foreground resume if background froze the timer past deadline', () => {
    const listeners = new Set<(state: string) => void>();
    const fire = vi.fn();

    const ctrl = createUndoController(
      10_000,
      () => {},
      (cb) => {
        listeners.add(cb);
        return () => listeners.delete(cb);
      },
    );

    ctrl.start(fire);
    for (const cb of listeners) cb('background');

    // 模拟 OS 冻结定时器：系统时间已经过了 12s，但定时器还没触发
    vi.setSystemTime(Date.now() + 12_000);
    expect(fire).not.toHaveBeenCalled();

    // 回到前台立刻补发
    for (const cb of listeners) cb('active');
    expect(fire).toHaveBeenCalledTimes(1);
    expect(ctrl.active).toBe(false);

    ctrl.dispose();
  });

  it('resumes remaining countdown when returning before deadline and still allows cancel()', () => {
    const listeners = new Set<(state: string) => void>();
    const fire = vi.fn();
    let latestRemaining = 10;

    const ctrl = createUndoController(
      10_000,
      (_active, remaining) => {
        latestRemaining = remaining;
      },
      (cb) => {
        listeners.add(cb);
        return () => listeners.delete(cb);
      },
    );

    ctrl.start(fire);
    for (const cb of listeners) cb('background');

    // 过了 4 秒回到前台，还剩 6 秒
    vi.setSystemTime(Date.now() + 4_000);
    for (const cb of listeners) cb('active');
    expect(fire).not.toHaveBeenCalled();
    expect(latestRemaining).toBe(6);

    // 再过 3 秒（总计 7 秒）仍然未发，并且可以 cancel()
    vi.advanceTimersByTime(3_000);
    expect(fire).not.toHaveBeenCalled();
    ctrl.cancel();
    expect(ctrl.active).toBe(false);

    // 超过原定 10 秒也不会再发
    vi.advanceTimersByTime(5_000);
    expect(fire).not.toHaveBeenCalled();

    ctrl.dispose();
  });
});
