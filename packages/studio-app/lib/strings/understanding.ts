/** 理解卡文案（SS-43）。 */

export const zh = {
  'understanding.title': '我们理解的需求',
  'understanding.titleDone': '已确认需求理解',
  'understanding.outOfScope': '本次不做',
  'understanding.expand': '展开其余 {n} 条',
  'understanding.collapse': '收起',
  'understanding.confirm': '对，就是这样',
  'understanding.reject': '不对…',
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
  'understanding.reject': 'Not quite…',
  'understanding.reasonPlaceholder': 'Tell us what needs correcting…',
  'understanding.reasonSend': 'Send back',
  'understanding.reasonCancel': 'Cancel',
  'understanding.confirmed': 'Confirmed',
  'understanding.rejected': 'Sent back for revision',
};
