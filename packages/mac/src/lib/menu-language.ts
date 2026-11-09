/**
 * The menu bar and the menu-bar icon's menu in the window's language (Settings › Appearance ›
 * Language): every word of i18n/en/menu.ts (zh-CN/menu.ts) goes to src-tauri/src/menu.rs (`set_menu_labels`), by
 * id, at start and whenever the language changes. Run / Stop Running changes as the run script
 * runs, so `useMenuState` (native.ts) sends that one with its state.
 */
import { inApp } from './boot.js';
import { subscribePrefs } from './prefs.js';
import { type Key, currentLocale, t } from '../i18n/index.js';
import { menu } from '../i18n/en/menu.js';

const KEYS = Object.keys(menu) as (keyof typeof menu)[];

/** Every menu word in the language shown now, id → text (`menu.` dropped), Run's aside. */
export const menuLabels = (): Record<string, string> => Object.fromEntries(KEYS.filter((k) => !k.startsWith('menu.ws-run')).map((k) => [k.slice('menu.'.length), t(k)]));

const COMMAND_WORDS: Readonly<Record<string, Key>> = { Run: 'menu.ws-run', 'Stop Running': 'menu.ws-run.stop' };

/** A command's own label (commands.ts) as the menu bar shows it, in the language shown now. */
export const menuWord = (label: string): string => {
  const key = COMMAND_WORDS[label];
  return key ? t(key) : label;
};

/** Send the menus their words now and on every language change (returns the way to stop). */
export function startMenuLanguage(): () => void {
  if (!inApp()) return () => undefined;
  // shortcut: English is what menu.rs builds, so nothing goes until the language changes (Windows keeps its own "Show in File Explorer" until then).
  let sent = currentLocale() === 'en' ? 'en' : '';
  const send = (): void => {
    const locale = currentLocale();
    if (locale === sent) return;
    sent = locale;
    void import('@tauri-apps/api/core').then(({ invoke }) => invoke('set_menu_labels', { labels: menuLabels() })).catch(() => undefined);
  };
  send();
  return subscribePrefs(send);
}
