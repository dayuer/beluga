/**
 * The languages a screen can show its own words in. A screen keeps a dictionary per language,
 * English its source: `makeT(en, { 'zh-CN': zh })` → `t(locale)(key, vars)`. Words that change with
 * a number are functions. Engine-made words (toasts, activity, notifications) aren't here yet: they
 * stay English. Browser-safe.
 */

export const LOCALES = ['en', 'zh-CN'] as const;
export type Locale = (typeof LOCALES)[number];
/** What Settings keeps: a language, or the system's. */
export type LanguageSetting = 'system' | Locale;
export const LANGUAGE_SETTINGS: readonly LanguageSetting[] = ['system', ...LOCALES];

export type Vars = Readonly<Record<string, string | number>>;
export type Entry = string | ((v: Vars) => string);
export type Dict = Readonly<Record<string, Entry>>;
/** Another language's dictionary: every key of the English one, so a missing word fails the typecheck. */
export type Translation<D extends Dict> = { readonly [K in keyof D]: Entry };

/** The language shown: the one picked, else the first of the system's that Beluga has (any Chinese: Simplified), else English. */
export function resolveLocale(setting: LanguageSetting | undefined, system: readonly string[]): Locale {
  if (setting === 'en' || setting === 'zh-CN') return setting;
  for (const tag of system) {
    const lang = tag.toLowerCase().split('-')[0];
    if (lang === 'zh') return 'zh-CN';
    if (lang === 'en') return 'en';
  }
  return 'en';
}

/** `{name}` takes its value; one without a value stays as written, so it shows. */
export const interpolate = (text: string, vars: Vars = {}): string => text.replace(/\{(\w+)\}/g, (all, name: string) => (name in vars ? String(vars[name]) : all));

/** A `t` per language over English and its translations; a language without one shows English. */
export function makeT<D extends Dict>(en: D, others: Partial<Record<Exclude<Locale, 'en'>, Translation<D>>>): (locale: Locale) => (key: keyof D & string, vars?: Vars) => string {
  return (locale) => {
    const dict: Translation<D> = (locale !== 'en' && others[locale]) || en;
    return (key, vars) => {
      const entry = dict[key] ?? en[key];
      return typeof entry === 'function' ? entry(vars ?? {}) : interpolate(entry ?? key, vars);
    };
  };
}
