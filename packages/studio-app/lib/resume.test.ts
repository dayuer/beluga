import { describe, expect, it, vi } from 'vitest';

vi.mock('react-native', () => ({
  AppState: {
    currentState: 'active',
    addEventListener: vi.fn(() => ({ remove: vi.fn() })),
  },
}));

import { onResume, type AppStateLike } from './resume';

function fakeAppState(initial = 'active') {
  const listeners = new Set<(state: string) => void>();
  const api: AppStateLike & { emit(next: string): void; count(): number } = {
    currentState: initial,
    addEventListener(_type, cb) {
      listeners.add(cb);
      return {
        remove: () => {
          listeners.delete(cb);
        },
      };
    },
    emit(next: string) {
      for (const cb of [...listeners]) cb(next);
    },
    count: () => listeners.size,
  };
  return api;
}

describe('onResume', () => {
  it('calls fn once when returning from background or inactive to active, and ignores active -> active', () => {
    const appState = fakeAppState('active');
    const fn = vi.fn();
    const stop = onResume(fn, appState);

    // active -> active 不触发
    appState.emit('active');
    expect(fn).not.toHaveBeenCalled();

    // active -> background -> active 触发一次
    appState.emit('background');
    expect(fn).not.toHaveBeenCalled();
    appState.emit('active');
    expect(fn).toHaveBeenCalledTimes(1);

    // active -> inactive -> active 再触发一次
    appState.emit('inactive');
    appState.emit('active');
    expect(fn).toHaveBeenCalledTimes(2);

    stop();
    expect(appState.count()).toBe(0);
  });

  it('triggers each subscribed refresh once per background -> active transition', () => {
    const appState = fakeAppState('active');
    const projectsLoad = vi.fn();
    const projectPlansLoad = vi.fn();
    const todosRefresh = vi.fn();
    const planRefresh = vi.fn();

    const stops = [
      onResume(projectsLoad, appState),
      onResume(projectPlansLoad, appState),
      onResume(todosRefresh, appState),
      onResume(planRefresh, appState),
    ];

    appState.emit('background');
    appState.emit('active');

    expect(projectsLoad).toHaveBeenCalledTimes(1);
    expect(projectPlansLoad).toHaveBeenCalledTimes(1);
    expect(todosRefresh).toHaveBeenCalledTimes(1);
    expect(planRefresh).toHaveBeenCalledTimes(1);

    for (const stop of stops) stop();
  });
});
