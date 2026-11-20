import { Appearance } from 'react-native';
import { kv } from './kv';

export type AppearanceMode = 'light' | 'dark' | 'system';

const APPEARANCE_KEY = 'prefs:appearance';

export function getAppearance(): AppearanceMode {
  const saved = kv.get<string>(APPEARANCE_KEY);
  if (saved === 'light' || saved === 'dark' || saved === 'system') return saved;
  return 'system';
}

export function applyAppearance(mode: AppearanceMode): void {
  if (typeof Appearance?.setColorScheme === 'function') {
    Appearance.setColorScheme(mode === 'system' ? 'unspecified' : mode);
  }
}

export function setAppearance(mode: AppearanceMode): void {
  kv.set(APPEARANCE_KEY, mode);
  applyAppearance(mode);
}
