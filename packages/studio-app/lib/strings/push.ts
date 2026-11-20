/** 推送权限引导与通知渠道文案（SS-163）。 */

export const zh = {
  'push.channel.needsYou': '等你',
  'push.denied.ios': '通知权限已关闭，请前往系统「设置 › Synon Studio › 通知」开启允许通知。',
  'push.denied.android': '通知权限已关闭，请前往系统「设置 › 应用 › Synon Studio › 通知」开启允许通知。',
} as const;

export const en: Record<keyof typeof zh, string> = {
  'push.channel.needsYou': 'Needs you',
  'push.denied.ios': 'Notifications are off. Enable them in System Settings › Synon Studio › Notifications.',
  'push.denied.android': 'Notifications are off. Enable them in System Settings › Apps › Synon Studio › Notifications.',
};
