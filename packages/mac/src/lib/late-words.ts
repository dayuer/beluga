/**
 * The window's words for the few lib files the preferences load before anything else
 * (shortcuts-model, os-words, terminal-import-model). i18n reads the preferences, so these can't
 * import it: that loop would leave the preferences, or a table read while modules start, without
 * them. It's loaded once everything has; until then (a moment at start) the words are English.
 */
import { type Vars, interpolate } from '../../../../src/shared/i18n.js';
import { common_lib } from '../i18n/en/common-lib.js';

type I18n = typeof import('../i18n/index.js');

let i18n: I18n | undefined;
void import('../i18n/index.js').then((m) => void (i18n = m));

/** One of lib's own words (i18n/en/common-lib.ts), in the language shown. */
export function say(key: keyof typeof common_lib, vars?: Vars): string {
  // (A module still starting can be handed i18n before its words are there.)
  if (typeof i18n?.t === 'function') return i18n.t(key, vars);
  const en: string | ((v: Vars) => string) = common_lib[key];
  return typeof en === 'function' ? en(vars ?? {}) : interpolate(en, vars);
}

/** `read(i18n)` once the dictionaries are there, else the English (for words looked up by id). */
export const late = (en: string, read: (w: I18n) => string): string => (typeof i18n?.t === 'function' ? read(i18n) : en);
