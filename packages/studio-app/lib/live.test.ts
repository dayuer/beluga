import { describe, expect, it, vi } from 'vitest';
import { createLive } from './live';

describe('live', () => {
  it('redials active subscriptions when resume callback fires', () => {
    const closes: number[] = [];
    let dials = 0;
    const watch = vi.fn((_pid: string, handlers: { state: (s: 'open' | 'closed') => void }) => {
      const id = ++dials;
      handlers.state('open');
      return () => {
        closes.push(id);
      };
    });

    const listeners = new Set<() => void>();
    const table = createLive({ watch }, (onResume) => {
      listeners.add(onResume);
      return () => listeners.delete(onResume);
    });

    const states: Array<'open' | 'closed'> = [];
    const unsub = table.subscribe('proj-1', {
      frame: () => {},
      state: (s) => states.push(s),
    });

    expect(watch).toHaveBeenCalledTimes(1);
    expect(states).toEqual(['open']);
    expect(listeners.size).toBe(1);

    for (const cb of listeners) cb();

    expect(closes).toEqual([1]);
    expect(watch).toHaveBeenCalledTimes(2);
    expect(states).toEqual(['open', 'open']);

    unsub();
    expect(closes).toEqual([1, 2]);
    expect(listeners.size).toBe(0);
  });
});
