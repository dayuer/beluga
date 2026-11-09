/**
 * The window's own words in your language (Settings › Appearance › Language; docs/superpowers/specs/
 * 2026-11-09-ui-i18n-design.md). Each area keeps its English in en/<area>.ts and its translations
 * in zh-CN/<area>.ts, typed so a missing word fails the typecheck. Components use `useT()`; code
 * outside React (menus built on a click) calls `t()`, which reads the language at that moment.
 */
import { type Locale, type Vars, makeT, resolveLocale } from '../../../../src/shared/i18n.js';
import { getPrefs, usePrefs } from '../lib/prefs.js';
import { settings as enSettings } from './en/settings.js';
import { settings as zhSettings } from './zh-CN/settings.js';
import { dialogs as enDialogs } from './en/dialogs.js';
import { dialogs as zhDialogs } from './zh-CN/dialogs.js';
import { layout as enLayout } from './en/layout.js';
import { layout as zhLayout } from './zh-CN/layout.js';
import { chat as enChat } from './en/chat.js';
import { chat as zhChat } from './zh-CN/chat.js';
import { plans as enPlans } from './en/plans.js';
import { plans as zhPlans } from './zh-CN/plans.js';

const EN = { ...enSettings, ...enDialogs, ...enLayout, ...enChat, ...enPlans } as const;
const ZH = { ...zhSettings, ...zhDialogs, ...zhLayout, ...zhChat, ...zhPlans };

export type Key = keyof typeof EN & string;
const tOf = makeT(EN, { 'zh-CN': ZH });

// Only a window has the Mac's languages: under Node (the tests) it's English, whatever the machine's locale.
const systemLanguages = (): readonly string[] => (typeof window === 'undefined' || typeof navigator === 'undefined' ? [] : (navigator.languages ?? [navigator.language]));

/** The language the window shows now. */
export const currentLocale = (): Locale => resolveLocale(getPrefs().language, systemLanguages());

/** Words in the language shown now (outside React: read at the call). */
export const t = (key: Key, vars?: Vars): string => tOf(currentLocale())(key, vars);

/** The language shown, kept up to date as Settings changes it. */
export function useLocale(): Locale {
  return resolveLocale(usePrefs().language, systemLanguages());
}

/** `t` for a component: it shows again in the new language as soon as it's picked. */
export function useT(): (key: Key, vars?: Vars) => string {
  return tOf(useLocale());
}
