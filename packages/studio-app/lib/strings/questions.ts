/** P3 问题卡文案（SS-42 / SS-182）。 */

import type { Lang } from './index.js';

export const zh = {
  'questions.cardTitle': '需要你确认几个问题',
  'questions.cardTitleDone': '已回答问题',
  'questions.number': '{i}.',
  'questions.multiHint': '可多选',
  'questions.writeOwn': '自己写…',
  'questions.writePlaceholder': '输入你的回答…',
  'questions.remaining': '还差 {n} 题',
  'questions.submit': '一起提交',
  'questions.submitting': '提交中…',
  'questions.submitted': '已提交回答',
  'questions.sendFailed': '发送失败，已保留你的选择，请重试',
  'questions.retry': '重试',
} as const;

export const en: Record<keyof typeof zh, string> = {
  'questions.cardTitle': 'A few questions for you',
  'questions.cardTitleDone': 'Questions answered',
  'questions.number': '{i}.',
  'questions.multiHint': 'Select one or more',
  'questions.writeOwn': 'Write my own…',
  'questions.writePlaceholder': 'Type your answer…',
  'questions.remaining': '{n} left',
  'questions.submit': 'Submit all',
  'questions.submitting': 'Sending…',
  'questions.submitted': 'Answers submitted',
  'questions.sendFailed': 'Failed to send. Your picks are kept — please retry.',
  'questions.retry': 'Retry',
};

export type QuestionsKey = keyof typeof zh;

const table: Record<Lang, Record<QuestionsKey, string>> = { zh, en };

export function tQuestions(lang: Lang, key: QuestionsKey, vars?: Record<string, string | number>): string {
  const text = table[lang][key] ?? table.zh[key];
  if (!vars) return text;
  return text.replace(/\{(\w+)\}/g, (whole, name: string) => (name in vars ? String(vars[name]) : whole));
}
