import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('react-native', () => ({
  AppState: {
    addEventListener: vi.fn(() => ({ remove: vi.fn() })),
  },
}));

import { createUndoController, createUndoStore } from './undo';

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

describe('undoStore', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-11-20T00:00:00.000Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('keeps only one bar at a time and fires the previous one when replaced', () => {
    let clock = 1000;
    const store = createUndoStore(() => () => {}, () => clock);
    const fire1 = vi.fn();
    const fire2 = vi.fn();

    store.show({ text: '已移除附件「设计稿.zip」', fire: fire1 });
    expect(store.getState().active).toBe(true);
    expect(store.getState().remaining).toBe(4);

    // 新的替换旧的：先 fire 旧的
    store.show({ text: '已通过「登录改版」', ms: 10_000, fire: fire2 });
    expect(fire1).toHaveBeenCalledTimes(1);
    expect(fire2).not.toHaveBeenCalled();
    expect(store.getState().text).toBe('已通过「登录改版」');
    expect(store.getState().remaining).toBe(10);

    clock += 10_000;
    vi.advanceTimersByTime(10_000);
    expect(fire2).toHaveBeenCalledTimes(1);
    expect(store.getState().active).toBe(false);

    store.dispose();
  });

  it('fires nothing when cancelled', () => {
    let clock = 1000;
    const store = createUndoStore(() => () => {}, () => clock);
    const fire = vi.fn();
    const onUndo = vi.fn();

    store.show({ text: '已删除变量 API_URL', fire, onUndo });
    clock += 1500;
    vi.advanceTimersByTime(1500);
    store.cancel();

    expect(onUndo).toHaveBeenCalledTimes(1);
    expect(store.getState().active).toBe(false);

    clock += 10_000;
    vi.advanceTimersByTime(10_000);
    expect(fire).not.toHaveBeenCalled();

    store.dispose();
  });

  it('flushes on foreground resume if fake clock passed deadline', () => {
    let clock = 1000;
    const listeners = new Set<(state: string) => void>();
    const store = createUndoStore(
      (cb) => {
        listeners.add(cb);
        return () => listeners.delete(cb);
      },
      () => clock,
    );
    const fire = vi.fn();

    store.show({ text: '已应用改动', fire });
    for (const cb of listeners) cb('background');

    clock += 5000;
    for (const cb of listeners) cb('active');
    expect(fire).toHaveBeenCalledTimes(1);
    expect(store.getState().active).toBe(false);

    store.dispose();
  });
});
