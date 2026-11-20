/** 底座通用组件文案（SS-144）：UndoBar、SignedButton、ConfirmSheet、Card、StatusDot。 */

export const zh = {
  'undo.button': '撤销',
  'signed.byDevice': '由这台设备确认',
  'signed.noKeyHint': '这台设备还没有登记密钥，无法确认此操作；请前往「我 › 设备」添加设备。',
  'confirm.cancel': '取消',
  'status.working': '进行中',
  'status.aiWorking': 'AI 在做',
  'status.needsYou': '等你',
  'status.waiting': '等待',
  'status.error': '需要处理',
  'status.done': '已完成',
} as const;

export const en: Record<keyof typeof zh, string> = {
  'undo.button': 'Undo',
  'signed.byDevice': 'Confirmed by this device',
  'signed.noKeyHint': 'This device has no key registered yet; go to Me › Devices to add one.',
  'confirm.cancel': 'Cancel',
  'status.working': 'Working',
  'status.aiWorking': 'AI working',
  'status.needsYou': 'Needs you',
  'status.waiting': 'Waiting',
  'status.error': 'Needs attention',
  'status.done': 'Done',
};
