/** 设计稿卡与代码卡文案（SS-46 / SS-182）。 */

import type { Lang } from './index.js';

export const zh = {
  'designCard.title': '设计稿',
  'designCard.defaultName': '设计稿资源包',
  'designCard.uploading': '上传中 {pct}%',
  'designCard.received': '已收下',
  'designCard.summary': '共 {files} 个文件（图片 {images} · 规范 {specs}）',
  'designCard.skipped': '已跳过 {n} 个无关文件',

  'codeCard.title': '代码交付',
  'codeCard.repo': '仓库',
  'codeCard.pr': '合并请求',
  'codeCard.state.ready': '待推送',
  'codeCard.state.pushed': '已推送',
  'codeCard.state.failed': '推送失败',
  'codeCard.retryPush': '重新推送',
  'codeCard.retrying': '推送中…',
  'codeCard.retryFailed': '推送失败，请稍后重试',
} as const;

export const en: Record<keyof typeof zh, string> = {
  'designCard.title': 'Design package',
  'designCard.defaultName': 'Design assets',
  'designCard.uploading': 'Uploading {pct}%',
  'designCard.received': 'Received',
  'designCard.summary': '{files} files ({images} images · {specs} specs)',
  'designCard.skipped': 'Skipped {n} unrelated files',

  'codeCard.title': 'Code delivery',
  'codeCard.repo': 'Repository',
  'codeCard.pr': 'Pull request',
  'codeCard.state.ready': 'Ready to push',
  'codeCard.state.pushed': 'Pushed',
  'codeCard.state.failed': 'Push failed',
  'codeCard.retryPush': 'Push again',
  'codeCard.retrying': 'Pushing…',
  'codeCard.retryFailed': 'Push failed, please try again',
};

export type CardsKey = keyof typeof zh;

const table: Record<Lang, Record<CardsKey, string>> = { zh, en };

export function tCards(lang: Lang, key: CardsKey, vars?: Record<string, string | number>): string {
  const text = table[lang][key] ?? table.zh[key];
  if (!vars) return text;
  return text.replace(/\{(\w+)\}/g, (whole, name: string) => (name in vars ? String(vars[name]) : whole));
}
