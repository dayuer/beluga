/** 理解卡文案（SS-43 / SS-182）。 */

import type { Lang } from './index.js';

export const zh = {
  'understanding.title': '我们理解的需求',
  'understanding.titleDone': '已确认需求理解',
  'understanding.outOfScope': '本次不做',
  'understanding.expand': '展开其余 {n} 条',
  'understanding.collapse': '收起',
  'understanding.confirm': '对，就是这样',
  'understanding.reject': '不对，我改一下',
  'understanding.undoToast': '已确认「需求理解」',
  'understanding.pendingUndo': '即将发出确认，可在下方撤销…',
  'understanding.reasonPlaceholder': '说说哪里理解不对…',
  'understanding.reasonSend': '发回修改',
  'understanding.reasonCancel': '取消',
  'understanding.confirmed': '已确认，继续推进',
  'understanding.rejected': '已发回修改',
} as const;

export const en: Record<keyof typeof zh, string> = {
  'understanding.title': 'What we understood',
  'understanding.titleDone': 'Understanding confirmed',
  'understanding.outOfScope': 'Out of scope',
  'understanding.expand': 'Show {n} more',
  'understanding.collapse': 'Show less',
  'understanding.confirm': 'Yes, that’s right',
  'understanding.reject': 'Not quite, let me edit',
  'understanding.undoToast': 'Confirmed understanding',
  'understanding.pendingUndo': 'Confirming shortly — undo below…',
  'understanding.reasonPlaceholder': 'Tell us what needs correcting…',
  'understanding.reasonSend': 'Send back',
  'understanding.reasonCancel': 'Cancel',
  'understanding.confirmed': 'Confirmed',
  'understanding.rejected': 'Sent back for revision',
};

export type UnderstandingKey = keyof typeof zh;

const table: Record<Lang, Record<UnderstandingKey, string>> = { zh, en };

export function tUnderstanding(lang: Lang, key: UnderstandingKey, vars?: Record<string, string | number>): string {
  const text = table[lang][key] ?? table.zh[key];
  if (!vars) return text;
  return text.replace(/\{(\w+)\}/g, (whole, name: string) => (name in vars ? String(vars[name]) : whole));
}
