import { beforeEach, describe, expect, it, vi } from 'vitest';

const store = new Map<string, unknown>();
const { setColorScheme, getColorScheme, listeners, emitChange } = vi.hoisted(() => {
  const listeners = new Set<() => void>();
  return {
    setColorScheme: vi.fn(),
    getColorScheme: vi.fn<() => 'light' | 'dark' | null>(() => 'light'),
    listeners,
    emitChange: () => {
      for (const fn of [...listeners]) fn();
    },
  };
});

vi.mock('react-native', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    Appearance: {
      getColorScheme,
      setColorScheme,
      addChangeListener: (fn: () => void) => {
        listeners.add(fn);
        return { remove: () => void listeners.delete(fn) };
      },
    },
  };
});

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

/** 每个用例一份新模块：主题和外观带着各自的模块状态，互不串。 */
const load = async () => {
  vi.resetModules();
  const theme = await import('./theme');
  const app = await import('./appearance');
  return { app, theme };
};

describe('lib/appearance', () => {
  beforeEach(() => {
    store.clear();
    listeners.clear();
    setColorScheme.mockClear();
    getColorScheme.mockReset();
    getColorScheme.mockReturnValue('light');
  });

  it('默认跟随系统：手机浅色时就是浅色', async () => {
    const { app, theme } = await load();
    expect(app.getAppearance()).toBe('system');
    expect(theme.scheme).toBe('light');
    expect(theme.color.bg).toBe('#F6F6F7');
  });

  it('切到深色真的换色板：color.bg 是 #1E1E21，切回浅色是 #F6F6F7', async () => {
    const { app, theme } = await load();

    app.setAppearance('dark');
    expect(app.getAppearance()).toBe('dark');
    expect(theme.scheme).toBe('dark');
    expect(theme.color.bg).toBe('#1E1E21');
    expect(theme.color.text).toBe('#ECECEE');
    expect(setColorScheme).toHaveBeenCalledWith('dark');

    app.setAppearance('light');
    expect(app.getAppearance()).toBe('light');
    expect(theme.scheme).toBe('light');
    expect(theme.color.bg).toBe('#F6F6F7');
    expect(setColorScheme).toHaveBeenCalledWith('light');

    app.setAppearance('system');
    expect(setColorScheme).toHaveBeenCalledWith('unspecified');
  });

  it('跟随系统时，系统切浅色 / 深色会换色板', async () => {
    const { app, theme } = await load();
    app.setAppearance('system');
    expect(theme.color.bg).toBe('#F6F6F7');

    getColorScheme.mockReturnValue('dark');
    emitChange();
    expect(theme.scheme).toBe('dark');
    expect(theme.color.bg).toBe('#1E1E21');

    getColorScheme.mockReturnValue('light');
    emitChange();
    expect(theme.color.bg).toBe('#F6F6F7');
  });

  it('固定深色后，系统变化不再动色板', async () => {
    const { app, theme } = await load();
    app.setAppearance('dark');

    getColorScheme.mockReturnValue('light');
    emitChange();
    expect(theme.color.bg).toBe('#1E1E21');
  });

  it('重启后按存下的外观还原', async () => {
    store.set('prefs:appearance', 'dark');
    const { app, theme } = await load();
    expect(app.getAppearance()).toBe('dark');
    expect(theme.color.bg).toBe('#1E1E21');
  });
});
