import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Calm mode's switch (packages/mac/src/fork/calm/index.ts): on by default, kept across a reload,
 * and put on <html> as data-calm before anything else draws (docs/calm-ui.md §13).
 */

/** A stand-in for the window's storage and its <html>, enough for fork/calm/index.ts. */
function windowish(): { readonly store: Map<string, string>; readonly dataset: Record<string, string | undefined> } {
  const store = new Map<string, string>();
  const dataset: Record<string, string | undefined> = {};
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => void store.set(key, value),
  });
  vi.stubGlobal('document', { documentElement: { dataset } });
  return { store, dataset };
}

const load = async () => import('../packages/mac/src/fork/calm/index.js');

describe('calm mode', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.unstubAllGlobals();
  });

  it('is on by default and sets data-calm on <html>', async () => {
    const { dataset } = windowish();
    const { CALM_KEY, calmOn } = await load();
    expect(CALM_KEY).toBe('beluga.fork.calm.v1');
    expect(calmOn()).toBe(true);
    expect(dataset.calm).toBe('1');
  });

  it('turns off, and stays off after a reload', async () => {
    const { store, dataset } = windowish();
    const { setCalm } = await load();
    setCalm(false);
    expect(dataset.calm).toBeUndefined();
    expect(store.get('beluga.fork.calm.v1')).toBe('{"calm":false}');

    vi.resetModules();
    const reloaded = await load();
    expect(reloaded.calmOn()).toBe(false);
    expect(dataset.calm).toBeUndefined();
  });

  it('turns back on, and is read as on after a reload', async () => {
    const { store, dataset } = windowish();
    const { setCalm } = await load();
    setCalm(false);
    setCalm(true);
    expect(dataset.calm).toBe('1');
    expect(store.get('beluga.fork.calm.v1')).toBe('{"calm":true}');

    vi.resetModules();
    const reloaded = await load();
    expect(reloaded.calmOn()).toBe(true);
    expect(dataset.calm).toBe('1');
  });
});
