import * as common from './common.js';
import * as login from './login.js';
import * as news from './new.js';
import * as plan from './plan.js';
import * as projects from './projects.js';
import * as todo from './todo.js';

export type Lang = 'zh' | 'en';

const zh = {
  ...common.zh,
  ...login.zh,
  ...projects.zh,
  ...plan.zh,
  ...todo.zh,
  ...news.zh,
} as const;

export type StringKey = keyof typeof zh;

const en: Record<StringKey, string> = {
  ...common.en,
  ...login.en,
  ...projects.en,
  ...plan.en,
  ...todo.en,
  ...news.en,
};

const table: Record<Lang, Record<StringKey, string>> = { zh, en };

/** Fill `{name}` slots; an unknown slot is left as written so a missed key is visible, not blank. */
export function t(lang: Lang, key: StringKey, vars?: Record<string, string | number>): string {
  const text = table[lang][key] ?? table.zh[key];
  if (!vars) return text;
  return text.replace(/\{(\w+)\}/g, (whole, name: string) => (name in vars ? String(vars[name]) : whole));
}

export { zh, en };
