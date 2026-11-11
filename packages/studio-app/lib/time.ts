import { t, type Lang } from './strings';

/** "刚刚 / x 分钟前 / x 小时前 / x 天前", the same in English. A clock that is ahead reads as
 * "刚刚" instead of a negative number. */
export function ago(from: number, lang: Lang = 'zh', now: number = Date.now()): string {
  const ms = Math.max(0, now - from);
  const minutes = Math.floor(ms / 60_000);
  if (minutes < 1) return t(lang, 'time.justNow');
  if (minutes < 60) return t(lang, 'time.minutes', { n: minutes });
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return t(lang, 'time.hours', { n: hours });
  return t(lang, 'time.days', { n: Math.floor(hours / 24) });
}
