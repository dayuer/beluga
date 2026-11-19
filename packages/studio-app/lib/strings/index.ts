import { getLocales } from 'expo-localization';
import { kv } from '../kv';
import * as common from './common';
import * as login from './login';
import * as news from './new';
import * as plan from './plan';
import * as projects from './projects';
import * as todo from './todo';

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

/**
 * 优先读取 kv 中的手动设置（`lang`）；未设置时跟随系统语言（英文系统用 en，其余默认 zh）。
 */
export function detectLang(): Lang {
  const saved = kv.get<string>('lang');
  if (saved === 'zh' || saved === 'en') return saved;
  try {
    const code = getLocales()[0]?.languageCode?.toLowerCase();
    return code === 'en' ? 'en' : 'zh';
  } catch {
    return 'zh';
  }
}

export { zh, en };
