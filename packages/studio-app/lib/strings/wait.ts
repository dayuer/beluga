/** P4 等待卡文案（SS-45 / SS-182）。 */

import type { Lang } from './index.js';

export const zh = {
  'wait.title': '暂时在等待',
  'wait.reason.offline': '执行机器暂时离线',
  'wait.reason.queued': '前面还有任务在排队',
  'wait.reason.quota': '当前用量已满',
  'wait.reason.needs-human': '需要工作室人员处理',
  'wait.eta.offline': '机器上线后会自动继续',
  'wait.eta.queued': '轮到后会自动继续',
  'wait.eta.quota': '用量恢复后会自动继续',
  'wait.eta.needs-human': '工作室处理完后会自动继续',
  'wait.noAction': '你不用做什么',
} as const;

export const en: Record<keyof typeof zh, string> = {
  'wait.title': 'Waiting to resume',
  'wait.reason.offline': 'The runner machine is temporarily offline',
  'wait.reason.queued': 'Waiting in the queue',
  'wait.reason.quota': 'Usage quota reached',
  'wait.reason.needs-human': 'Needs the studio team',
  'wait.eta.offline': 'Resumes automatically once online',
  'wait.eta.queued': 'Resumes automatically when next in line',
  'wait.eta.quota': 'Resumes automatically when quota resets',
  'wait.eta.needs-human': 'Resumes automatically once handled',
  'wait.noAction': 'You don’t need to do anything',
};

export type WaitKey = keyof typeof zh;

const table: Record<Lang, Record<WaitKey, string>> = { zh, en };

export function tWait(lang: Lang, key: WaitKey, vars?: Record<string, string | number>): string {
  const text = table[lang][key] ?? table.zh[key];
  if (!vars) return text;
  return text.replace(/\{(\w+)\}/g, (whole, name: string) => (name in vars ? String(vars[name]) : whole));
}
