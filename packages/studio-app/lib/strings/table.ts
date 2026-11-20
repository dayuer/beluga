import * as base from './base.js';
import * as cards from './cards.js';
import * as common from './common.js';
import * as drawer from './drawer.js';
import * as login from './login.js';
import * as news from './new.js';
import * as plan from './plan.js';
import * as projects from './projects.js';
import * as questions from './questions.js';
import * as steps from './steps.js';
import * as tabs from './tabs.js';
import * as todo from './todo.js';
import * as understanding from './understanding.js';
import * as wait from './wait.js';

export type Lang = 'zh' | 'en';

const zh = {
  ...base.zh,
  ...common.zh,
  ...login.zh,
  ...projects.zh,
  ...plan.zh,
  ...todo.zh,
  ...news.zh,
  ...tabs.zh,
  ...questions.zh,
  ...understanding.zh,
  ...steps.zh,
  ...wait.zh,
  ...cards.zh,
  ...drawer.zh,
} as const;

export type StringKey = keyof typeof zh;

const en: Record<StringKey, string> = {
  ...base.en,
  ...common.en,
  ...login.en,
  ...projects.en,
  ...plan.en,
  ...todo.en,
  ...news.en,
  ...tabs.en,
  ...questions.en,
  ...understanding.en,
  ...steps.en,
  ...wait.en,
  ...cards.en,
  ...drawer.en,
};

const table: Record<Lang, Record<StringKey, string>> = { zh, en };

/** Fill `{name}` slots; an unknown slot is left as written so a missed key is visible, not blank. */
export function t(lang: Lang, key: StringKey, vars?: Record<string, string | number>): string {
  const text = table[lang][key] ?? table.zh[key];
  if (!vars) return text;
  return text.replace(/\{(\w+)\}/g, (whole, name: string) => (name in vars ? String(vars[name]) : whole));
}

export { zh, en };
