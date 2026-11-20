import type { Lang } from './table';

export const zh = {
  'requests.title': '需求',
  'requests.newBtn': '提需求',
  'requests.searchPlaceholder': '搜索需求或项目',
  'requests.needsYouSection': '等你处理',
  'requests.empty': '还没有需求',
  'requests.emptyBody': '点右上角「提需求」，告诉工作室你想做什么',
  'requests.searchEmpty': '没有匹配的需求',
  'requests.groupCount': '{n} 条',
} as const;

export type RequestsStringKey = keyof typeof zh;

export const en: Record<RequestsStringKey, string> = {
  'requests.title': 'Requests',
  'requests.newBtn': 'New request',
  'requests.searchPlaceholder': 'Search requests or projects',
  'requests.needsYouSection': 'Needs your attention',
  'requests.empty': 'No requests yet',
  'requests.emptyBody': 'Tap “New request” above to tell your studio what to build',
  'requests.searchEmpty': 'No matching requests',
  'requests.groupCount': '{n}',
};

const table: Record<Lang, Record<RequestsStringKey, string>> = { zh, en };

export function tRequests(
  lang: Lang,
  key: RequestsStringKey,
  vars?: Record<string, string | number>,
): string {
  const text = table[lang][key] ?? table.zh[key];
  if (!vars) return text;
  return text.replace(/\{(\w+)\}/g, (whole, name: string) =>
    name in vars ? String(vars[name]) : whole,
  );
}
