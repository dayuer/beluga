import { getLocales } from 'expo-localization';
import { kv } from '../kv';
import { en, t, zh, type Lang, type StringKey } from './table.js';

export { en, t, zh, type Lang, type StringKey };

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
