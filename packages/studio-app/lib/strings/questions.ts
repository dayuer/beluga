/** P3 问题卡文案（SS-42 / SS-182 / SS-252）。 */

import type { Lang } from './index.js';

export const zh = {
  'questions.cardTitle': '需要你确认几个问题',
  'questions.cardTitleDone': '已回答问题',
  'questions.suggested': '我先按：{answer}',
  'questions.change': '改…',
  'questions.changed': '改成：{text}',
  'questions.revert': '撤回',
  'questions.editPlaceholder': '说说你想怎么改…',
  'questions.editDone': '完成',
  'questions.submit': '就这样',
  'questions.submitted': '已发出',
  'questions.sendFailed': '没发出去，请再点一次「就这样」',
  'questions.moreInChat': '还有 {n} 条，在对话里说就行',
  'questions.undo': '已按建议答复，4 秒内可撤销',
} as const;

export const en: Record<keyof typeof zh, string> = {
  'questions.cardTitle': 'A few questions for you',
  'questions.cardTitleDone': 'Questions answered',
  'questions.suggested': 'I’ll go with: {answer}',
  'questions.change': 'Change…',
  'questions.changed': 'Changed to: {text}',
  'questions.revert': 'Revert',
  'questions.editPlaceholder': 'Say what you’d prefer…',
  'questions.editDone': 'Done',
  'questions.submit': 'Go with that',
  'questions.submitted': 'Sent',
  'questions.sendFailed': 'Not sent. Tap “Go with that” again.',
  'questions.moreInChat': '{n} more — just say them in the chat',
  'questions.undo': 'Sent with the suggested answers — undo for 4 seconds',
};

export type QuestionsKey = keyof typeof zh;

const table: Record<Lang, Record<QuestionsKey, string>> = { zh, en };

export function tQuestions(lang: Lang, key: QuestionsKey, vars?: Record<string, string | number>): string {
  const text = table[lang][key] ?? table.zh[key];
  if (!vars) return text;
  return text.replace(/\{(\w+)\}/g, (whole, name: string) => (name in vars ? String(vars[name]) : whole));
}
