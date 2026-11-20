/** 底部/顶部三页签与「我」页签占位文案（SS-140）。 */

export const zh = {
  'tabs.requests': '需求',
  'tabs.todo': '待办',
  'tabs.me': '我',
  'me.placeholder': '设置与设备管理',
} as const;

export const en: Record<keyof typeof zh, string> = {
  'tabs.requests': 'Requests',
  'tabs.todo': 'To-dos',
  'tabs.me': 'Me',
  'me.placeholder': 'Settings and devices',
};
