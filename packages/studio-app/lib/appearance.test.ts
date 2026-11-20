import { beforeEach, describe, expect, it, vi } from 'vitest';

const store = new Map<string, unknown>();
const { setColorScheme } = vi.hoisted(() => ({ setColorScheme: vi.fn() }));

vi.mock('react-native', () => ({
  Appearance: { setColorScheme },
}));

vi.mock('./kv', () => ({
  kv: {
    get: <T,>(k: string) => store.get(k) as T | undefined,
    set: (k: string, v: unknown) => {
      store.set(k, v);
    },
    remove: (k: string) => {
      store.delete(k);
    },
  },
}));

import { getAppearance, setAppearance } from './appearance';

describe('lib/appearance', () => {
  beforeEach(() => {
    store.clear();
    setColorScheme.mockClear();
  });

  it('persists appearance mode to kv and calls Appearance.setColorScheme', () => {
    expect(getAppearance()).toBe('system');

    setAppearance('dark');
    expect(getAppearance()).toBe('dark');
    expect(setColorScheme).toHaveBeenCalledWith('dark');

    setAppearance('light');
    expect(getAppearance()).toBe('light');
    expect(setColorScheme).toHaveBeenCalledWith('light');

    setAppearance('system');
    expect(getAppearance()).toBe('system');
    expect(setColorScheme).toHaveBeenCalledWith('unspecified');
  });
});
