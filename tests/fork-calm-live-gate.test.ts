import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The live clock's gate (fork/calm/live-gate.ts, docs/calm/hooks.md §4): in calm mode only the
 * current step row's mark moves; everything else rests. With calm mode off every mark moves, as
 * upstream. The clock itself is measured by packages/mac/scripts/calm-check.mjs.
 */

/** A stand-in for the window, and an element with (or without) a [data-current] row above it. */
function windowish(calm: boolean): void {
  const store = new Map([['beluga.fork.calm.v1', JSON.stringify({ calm })]]);
  vi.stubGlobal('localStorage', { getItem: (key: string) => store.get(key) ?? null, setItem: () => undefined });
  vi.stubGlobal('document', { documentElement: { dataset: {} as Record<string, string | undefined> } });
}

const inside = (current: boolean): Element => ({ closest: (selector: string) => (current && selector === '[data-current]' ? {} : null) }) as unknown as Element;

const load = async () => import('../packages/mac/src/fork/calm/live-gate.js');

beforeEach(() => {
  vi.resetModules();
  vi.unstubAllGlobals();
});

describe('calm mode lets one loop move', () => {
  it('lets only the current step row move while calm mode is on', async () => {
    windowish(true);
    const { calmLive } = await load();
    expect(calmLive(inside(true))).toBe(true);
    expect(calmLive(inside(false))).toBe(false);
  });

  it('lets every mark move with calm mode off, as upstream', async () => {
    windowish(false);
    const { calmLive } = await load();
    expect(calmLive(inside(true))).toBe(true);
    expect(calmLive(inside(false))).toBe(true);
  });

  it('follows the switch in Settings', async () => {
    windowish(false);
    const { calmLive } = await load();
    const { setCalm } = await import('../packages/mac/src/fork/calm/index.js');
    expect(calmLive(inside(false))).toBe(true);
    setCalm(true);
    expect(calmLive(inside(false))).toBe(false);
    expect(calmLive(inside(true))).toBe(true);
  });
});
