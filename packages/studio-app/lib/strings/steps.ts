/** P4 步骤条文案（SS-44 / SS-182）。 */

import type { Lang } from './index.js';

export const zh = {
  'steps.status.done': '已完成',
  'steps.status.active': '进行中',
  'steps.status.waiting': '等待中',
  'steps.status.todo': '未开始',
  'steps.a11y': '第 {i} / {n} 步：{title}，{status}',
  'steps.stepLabel': '第 {i} 步 · {status}',
  'steps.noSummary': '按计划推进中',
} as const;

export const en: Record<keyof typeof zh, string> = {
  'steps.status.done': 'Done',
  'steps.status.active': 'In progress',
  'steps.status.waiting': 'Waiting',
  'steps.status.todo': 'Not started',
  'steps.a11y': 'Step {i} of {n}: {title}, {status}',
  'steps.stepLabel': 'Step {i} · {status}',
  'steps.noSummary': 'Proceeding as planned',
};

export type StepsKey = keyof typeof zh;

const table: Record<Lang, Record<StepsKey, string>> = { zh, en };

export function tSteps(lang: Lang, key: StepsKey, vars?: Record<string, string | number>): string {
  const text = table[lang][key] ?? table.zh[key];
  if (!vars) return text;
  return text.replace(/\{(\w+)\}/g, (whole, name: string) => (name in vars ? String(vars[name]) : whole));
}
