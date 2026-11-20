import type { Lang } from './table.js';

export const zh = {
  'join.title': '登记这台设备',
  'join.subtitle': '核对节点指纹后，这台手机将生成专属密钥并完成登记。',
  'join.invalidLink': '邀请链接不完整或格式不对，请向搭环境的人重新索取。',
  'join.errUsed': '这个一次性邀请码已经用过了。每条邀请链接只能登记一台设备，请向搭环境的人重新获取。',
  'join.errExpired': '这条邀请链接已过期（超过 7 天有效期），请让搭环境的人重新生成一条。',
  'join.errFingerprint': '节点返回的指纹与链接里的不一致，已中止登记。请勿继续，并立即联系搭环境的人核实。',
  'join.errOffline': '当前没有网络连接，连上网后再试一次。',
  'join.errFailed': '登记没能完成，请稍后再试，或联系搭环境的人。',
  'join.backHome': '返回首页',
} as const;

export const en: Record<keyof typeof zh, string> = {
  'join.title': 'Enroll this device',
  'join.subtitle': 'Verify the node fingerprint below to generate a device key and finish enrollment.',
  'join.invalidLink': 'This invite link is incomplete or invalid. Ask your administrator for a new one.',
  'join.errUsed': 'This one-time invite code has already been used. Ask your administrator for a new link.',
  'join.errExpired': 'This invite link has expired (valid for 7 days). Ask your administrator for a new one.',
  'join.errFingerprint': 'The node fingerprint did not match the invite link. Enrollment was aborted — contact your administrator.',
  'join.errOffline': 'You are offline. Reconnect and try again.',
  'join.errFailed': 'Enrollment failed. Try again shortly or contact your administrator.',
  'join.backHome': 'Back to home',
};

export type JoinStringKey = keyof typeof zh;

export function joinT(lang: Lang, key: JoinStringKey): string {
  return lang === 'en' ? en[key] : zh[key];
}
