import { describe, expect, it, vi } from 'vitest';

const listeners = new Set<(state: string) => void>();

vi.mock('./client', () => ({
  hub: {
    watch: vi.fn(() => () => {}),
  },
}));

vi.mock('react-native', () => ({
  AppState: {
    currentState: 'active',
    addEventListener: vi.fn((_event: string, cb: (state: string) => void) => {
      listeners.add(cb);
      return {
        remove: () => {
          listeners.delete(cb);
        },
      };
    }),
  },
}));

import { createLive } from './live';

describe('live', () => {
  it('redials active subscriptions when AppState returns to active from background', () => {
    const closes: number[] = [];
    let dials = 0;
    const watch = vi.fn((_pid: string, handlers: { state: (s: 'open' | 'closed') => void }) => {
      const id = ++dials;
      handlers.state('open');
      return () => {
        closes.push(id);
      };
    });

    const table = createLive({ watch });
    const states: Array<'open' | 'closed'> = [];
    const unsub = table.subscribe('proj-1', {
      frame: () => {},
      state: (s) => states.push(s),
    });

    expect(watch).toHaveBeenCalledTimes(1);
    expect(states).toEqual(['open']);

    for (const cb of listeners) cb('background');
    for (const cb of listeners) cb('active');

    expect(closes).toEqual([1]);
    expect(watch).toHaveBeenCalledTimes(2);
    expect(states).toEqual(['open', 'open']);

    unsub();
    expect(closes).toEqual([1, 2]);
    expect(listeners.size).toBe(0);
  });
});
