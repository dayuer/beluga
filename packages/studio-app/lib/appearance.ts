import { useSyncExternalStore } from 'react';
import { Appearance } from 'react-native';
import { kv } from './kv';
import { type Scheme, setScheme } from './theme';

/**
 * 外观（浅色 / 深色 / 跟随系统），存 kv。和 companion 的 lib/appearance.ts 同一套做法：
 * 解析出的 scheme 真的交给 `theme.setScheme` 换色板，并让 `useScheme()` 的调用方重渲染；
 * `theme` 的 `color.*` 只在渲染时读，所以换色时整屏跟着换，不需要 remount。
 */
export type AppearanceMode = 'light' | 'dark' | 'system';

const APPEARANCE_KEY = 'prefs:appearance';

interface NativeAppearance {
  getColorScheme?: () => string | null;
  setColorScheme?: (scheme: 'light' | 'dark' | 'unspecified' | null) => void;
  addChangeListener?: (fn: () => void) => { remove: () => void };
}

/**
 * 单元测试里 `react-native` 的局部 mock 可能没有 `Appearance`，取到时 Vitest 会抛错而不是给
 * undefined；这里吞掉它，回到「浅色 + 不跟随系统」的保守行为。
 */
const native = (): NativeAppearance | undefined => {
  try {
    return Appearance as NativeAppearance;
  } catch {
    return undefined;
  }
};

const listeners = new Set<() => void>();

const readSaved = (): AppearanceMode => {
  const saved = kv.get<AppearanceMode>(APPEARANCE_KEY);
  return saved === 'light' || saved === 'dark' || saved === 'system' ? saved : 'system';
};

let mode: AppearanceMode = readSaved();

const systemScheme = (): Scheme => (native()?.getColorScheme?.() === 'dark' ? 'dark' : 'light');
const resolve = (): Scheme => (mode === 'system' ? systemScheme() : mode);

let current: Scheme = resolve();
setScheme(current);

function notify(): void {
  for (const fn of [...listeners]) fn();
}

/** 换色板（真的变了才换），并通知订阅者重渲染。 */
function syncPalette(): void {
  const next = resolve();
  if (next === current) return;
  current = next;
  setScheme(next);
  notify();
}

/** 当前生效的 scheme。各屏调用它，浅色 ↔ 深色切换时重渲染。 */
export function useScheme(): Scheme {
  return useSyncExternalStore(
    (fn) => (listeners.add(fn), () => void listeners.delete(fn)),
    () => current,
  );
}

export function getAppearance(): AppearanceMode {
  return mode;
}

/** 应用外观：换色板，并让原生控件（Switch 等）跟随同一套明暗。 */
export function applyAppearance(next: AppearanceMode = mode): void {
  mode = next;
  syncPalette();
  const appearance = native();
  if (typeof appearance?.setColorScheme === 'function') {
    appearance.setColorScheme(mode === 'system' ? 'unspecified' : mode);
  }
  notify();
}

export function setAppearance(next: AppearanceMode): void {
  kv.set(APPEARANCE_KEY, next);
  applyAppearance(next);
}

// 跟随系统时，系统切浅色 / 深色要立刻换色板。
const appearance = native();
if (typeof appearance?.addChangeListener === 'function') {
  appearance.addChangeListener(() => {
    if (mode === 'system') syncPalette();
  });
}
